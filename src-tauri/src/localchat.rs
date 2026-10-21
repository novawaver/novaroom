//! Local chat: messages between Novaroom apps on the same office network, with no internet needed.
//!
//! Apps find each other with mDNS (the same lookup printers use) and talk over direct TCP
//! connections, encrypted and authenticated with the Noise protocol. Each account has its own key
//! pair on each computer. Its public half is registered with Novaroom's server while online, and
//! every app keeps the last list of registered keys it downloaded, so a peer is only accepted when
//! its key belongs to the account it claims, even with no internet at all.
//!
//! Messages are kept in a SQLite file on this computer and never reach the server. There are two
//! kinds of chat: one room for everyone on the network, and direct chats between two people.
//! Direct messages wait on the sender's computer until the recipient's app confirms it has them.
//! There is no server to hold messages, so each app only shares what its own person wrote: when two
//! apps connect, each sends its recent room messages and any direct messages still waiting.

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, watch};

const SERVICE_TYPE: &str = "_novaroom._tcp.local.";
const NOISE_PARAMS: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";
/// Mixed into every handshake, so a Noise peer from some other program can never connect.
const PROLOGUE: &[u8] = b"novaroom-local-chat";
/// Raised when the frames change in a way older apps cannot read.
const PROTOCOL: u32 = 1;
/// The chat id of the room everyone on the network shares. Direct chats use the other person's id.
pub const ROOM: &str = "room";
/// Longest message, in characters, as in the app's other chats.
const MAX_BODY: usize = 4000;
const MAX_NAME: usize = 100;
/// Room messages an app shares with someone who has just connected: its own, from this long ago.
const ROOM_HISTORY_MS: i64 = 7 * 24 * 60 * 60 * 1000;
const ROOM_HISTORY_LIMIT: i64 = 200;
/// Messages shown when a chat opens.
const CHAT_LIMIT: i64 = 500;
/// The longest Noise message, which is also the most one length-prefixed packet can hold.
const NOISE_MAX: usize = 65535;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const PING_EVERY: Duration = Duration::from_secs(20);
/// A connection that has sent nothing, not even a ping, for this long is gone.
const IDLE_LIMIT: Duration = Duration::from_secs(60);
/// How often to try again to reach apps that were found on the network but are not connected.
const RETRY_EVERY: Duration = Duration::from_secs(15);

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat, sent_at);
CREATE TABLE IF NOT EXISTS directory (
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (user_id, public_key)
);
";

/// A message as the app shows it. `chat` is from this computer's point of view: "room", or the
/// other person's id in a direct chat, whichever of the two sent it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalMessage {
    id: String,
    chat: String,
    sender_id: String,
    sender_name: String,
    body: String,
    /// Milliseconds since 1970, by the sender's clock.
    sent_at: i64,
    /// Own direct messages: whether the other person's app has it. Always true for room messages.
    delivered: bool,
}

/// Someone whose app is connected right now.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalPeer {
    user_id: String,
    name: String,
}

/// A chat with messages, for the list of chats.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalChatSummary {
    chat: String,
    name: String,
    last_body: String,
    last_at: i64,
}

/// One registered key, downloaded from the server while online.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    user_id: String,
    public_key: String,
    name: String,
}

/// What two apps send each other, as JSON inside encrypted Noise messages.
#[derive(Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
enum Frame {
    #[serde(rename_all = "camelCase")]
    Hello { user_id: String, name: String, protocol: u32 },
    /// The sender is whoever is on the other end of the connection, never a field, so nobody can
    /// send a message in someone else's name. `to` is the recipient's id, or none for the room.
    #[serde(rename_all = "camelCase")]
    Message { id: String, to: Option<String>, name: String, body: String, sent_at: i64 },
    Ack { id: String },
    Ping,
}

struct Peer {
    user_id: String,
    name: String,
    /// The public key of the app that opened this connection, to pick one when two apps connect
    /// to each other at the same moment.
    opened_by: String,
    connection: u64,
    outbox: mpsc::UnboundedSender<Frame>,
    /// Dropped when this entry is removed or replaced, which ends the connection.
    _close: oneshot::Sender<()>,
}

/// An app found on the network: where to reach it.
struct Found {
    key: String,
    addresses: Vec<SocketAddr>,
}

struct Session {
    app: AppHandle,
    user_id: String,
    name: Mutex<String>,
    private_key: Vec<u8>,
    public_key: String,
    db: Mutex<Connection>,
    /// Connected apps by their public key. One person may be on several computers.
    peers: Mutex<HashMap<String, Peer>>,
    /// Apps found on the network, by their mDNS name.
    found: Mutex<HashMap<String, Found>>,
    /// Keys of apps being connected to right now, so each is only dialled once at a time.
    dialling: Mutex<HashSet<String>>,
    mdns: ServiceDaemon,
    service_name: String,
    stop: watch::Sender<bool>,
    next_connection: AtomicU64,
}

/// The running Local chat, if any. It runs for the signed-in account while the app is open.
#[derive(Default)]
pub struct LocalChat(Mutex<Option<Arc<Session>>>);

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// Account ids become folder names, so only accept what a real id looks like.
fn valid_user_id(user_id: &str) -> bool {
    !user_id.is_empty()
        && user_id.len() <= 64
        && user_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// This account's Local chat folder on this computer.
fn account_dir(app: &AppHandle, user_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(message)?
        .join("local-chat")
        .join(user_id);
    std::fs::create_dir_all(&dir).map_err(message)?;
    Ok(dir)
}

/// This account's key pair on this computer, made the first time it is needed.
fn load_keys(dir: &std::path::Path) -> Result<(Vec<u8>, Vec<u8>), String> {
    let path = dir.join("identity.key");
    if let Ok(bytes) = std::fs::read(&path) {
        if bytes.len() == 64 {
            return Ok((bytes[..32].to_vec(), bytes[32..].to_vec()));
        }
    }
    let params = NOISE_PARAMS.parse().map_err(message)?;
    let keypair = snow::Builder::new(params).generate_keypair().map_err(message)?;
    let mut bytes = keypair.private.clone();
    bytes.extend_from_slice(&keypair.public);
    std::fs::write(&path, bytes).map_err(message)?;
    Ok((keypair.private, keypair.public))
}

fn noise_builder(private_key: &[u8]) -> Result<snow::Builder<'_>, String> {
    let params = NOISE_PARAMS.parse().map_err(message)?;
    snow::Builder::new(params)
        .prologue(PROLOGUE)
        .map_err(message)?
        .local_private_key(private_key)
        .map_err(message)
}

impl Session {
    fn me(&self) -> LocalPeer {
        LocalPeer {
            user_id: self.user_id.clone(),
            name: self.name.lock().unwrap().clone(),
        }
    }

    /// The name the directory has for this key, if it belongs to this account. None means the key
    /// is not one the account registered (as of the last download), so the peer is turned away.
    fn verify(&self, user_id: &str, key: &str) -> Option<String> {
        let db = self.db.lock().unwrap();
        db.query_row(
            "SELECT name FROM directory WHERE user_id = ?1 AND public_key = ?2",
            params![user_id, key],
            |row| row.get(0),
        )
        .ok()
    }

    /// Everyone connected, once each, without this person's own other computers.
    fn peer_list(&self) -> Vec<LocalPeer> {
        let peers = self.peers.lock().unwrap();
        let mut seen = HashSet::new();
        let mut list: Vec<LocalPeer> = peers
            .values()
            .filter(|peer| peer.user_id != self.user_id && seen.insert(peer.user_id.clone()))
            .map(|peer| LocalPeer {
                user_id: peer.user_id.clone(),
                name: peer.name.clone(),
            })
            .collect();
        list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        list
    }

    fn emit_peers(&self) {
        let _ = self.app.emit("local-chat-peers", self.peer_list());
    }

    /// Saves a message unless it is already here. True if it was new.
    fn store(&self, item: &LocalMessage) -> bool {
        let db = self.db.lock().unwrap();
        db.execute(
            "INSERT OR IGNORE INTO messages (id, chat, sender_id, sender_name, body, sent_at, delivered)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![item.id, item.chat, item.sender_id, item.sender_name, item.body, item.sent_at, item.delivered],
        )
        .map(|changed| changed > 0)
        .unwrap_or(false)
    }

    /// What to send someone who has just connected: this person's recent room messages, then their
    /// direct messages to them that are still waiting.
    fn backlog(&self, peer_user_id: &str) -> Vec<Frame> {
        let db = self.db.lock().unwrap();
        let read = |sql: &str, args: &[&dyn rusqlite::ToSql]| -> Vec<Frame> {
            let Ok(mut statement) = db.prepare(sql) else { return Vec::new() };
            statement
                .query_map(args, |row| {
                    let chat: String = row.get(1)?;
                    Ok(Frame::Message {
                        id: row.get(0)?,
                        to: (chat != ROOM).then_some(chat),
                        name: row.get(2)?,
                        body: row.get(3)?,
                        sent_at: row.get(4)?,
                    })
                })
                .map(|rows| rows.filter_map(Result::ok).collect())
                .unwrap_or_default()
        };
        let since = now_ms() - ROOM_HISTORY_MS;
        let mut frames = read(
            "SELECT * FROM (
               SELECT id, chat, sender_name, body, sent_at FROM messages
               WHERE chat = ?1 AND sender_id = ?2 AND sent_at > ?3
               ORDER BY sent_at DESC LIMIT ?4
             ) ORDER BY sent_at",
            &[&ROOM, &self.user_id, &since, &ROOM_HISTORY_LIMIT],
        );
        // My other computers keep their own direct chats; they only share the room.
        if peer_user_id != self.user_id {
            frames.extend(read(
                "SELECT id, chat, sender_name, body, sent_at FROM messages
                 WHERE chat = ?1 AND sender_id = ?2 AND delivered = 0 ORDER BY sent_at",
                &[&peer_user_id, &self.user_id],
            ));
        }
        frames
    }

    /// Hands a frame to every connection for these people (all of them for the room).
    fn send_to(&self, user_id: Option<&str>, frame_for: impl Fn() -> Frame) {
        let peers = self.peers.lock().unwrap();
        for peer in peers.values() {
            if user_id.is_none_or(|id| id == peer.user_id) {
                let _ = peer.outbox.send(frame_for());
            }
        }
    }
}

// Connections ---------------------------------------------------------------------------------------

async fn read_packet(reader: &mut OwnedReadHalf) -> std::io::Result<Vec<u8>> {
    let length = reader.read_u16().await?;
    let mut packet = vec![0; usize::from(length)];
    reader.read_exact(&mut packet).await?;
    Ok(packet)
}

async fn write_packet(writer: &mut OwnedWriteHalf, packet: &[u8]) -> std::io::Result<()> {
    let length = u16::try_from(packet.len()).map_err(|_| std::io::ErrorKind::InvalidInput)?;
    writer.write_u16(length).await?;
    writer.write_all(packet).await
}

/// The Noise XX handshake: both sides prove they hold the private key behind their public key.
async fn handshake(
    private_key: &[u8],
    reader: &mut OwnedReadHalf,
    writer: &mut OwnedWriteHalf,
    initiator: bool,
) -> Result<snow::TransportState, String> {
    let builder = noise_builder(private_key)?;
    let mut noise = if initiator {
        builder.build_initiator()
    } else {
        builder.build_responder()
    }
    .map_err(message)?;
    let mut buffer = vec![0u8; NOISE_MAX];
    let mut payload = vec![0u8; NOISE_MAX];
    // XX takes three messages: initiator, responder, initiator.
    for step in 0..3 {
        if (step % 2 == 0) == initiator {
            let length = noise.write_message(&[], &mut buffer).map_err(message)?;
            write_packet(writer, &buffer[..length]).await.map_err(message)?;
        } else {
            let packet = read_packet(reader).await.map_err(message)?;
            noise.read_message(&packet, &mut payload).map_err(message)?;
        }
    }
    noise.into_transport_mode().map_err(message)
}

fn seal(noise: &Mutex<snow::TransportState>, frame: &Frame) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(frame).map_err(message)?;
    let mut packet = vec![0u8; json.len() + 16];
    let length = noise.lock().unwrap().write_message(&json, &mut packet).map_err(message)?;
    packet.truncate(length);
    Ok(packet)
}

fn open(noise: &Mutex<snow::TransportState>, packet: &[u8]) -> Result<Frame, String> {
    let mut json = vec![0u8; packet.len()];
    let length = noise.lock().unwrap().read_message(packet, &mut json).map_err(message)?;
    serde_json::from_slice(&json[..length]).map_err(message)
}

/// Runs one connection from handshake to close. Peers that cannot prove who they are are dropped.
async fn run_connection(session: Arc<Session>, stream: TcpStream, initiator: bool) {
    let _ = stream.set_nodelay(true);
    let (mut reader, mut writer) = stream.into_split();
    let Ok(Ok(noise)) =
        tokio::time::timeout(HANDSHAKE_TIMEOUT, handshake(&session.private_key, &mut reader, &mut writer, initiator)).await
    else {
        return;
    };
    let Some(remote_key) = noise.get_remote_static().map(to_hex) else { return };
    // Our own announcement, found by our own search.
    if remote_key == session.public_key {
        return;
    }
    let noise = Arc::new(Mutex::new(noise));

    // Both sides say who they are, then each checks the other's key against the directory.
    let me = session.me();
    let hello = Frame::Hello { user_id: me.user_id, name: me.name, protocol: PROTOCOL };
    let Ok(packet) = seal(&noise, &hello) else { return };
    if write_packet(&mut writer, &packet).await.is_err() {
        return;
    }
    let Ok(Ok(packet)) = tokio::time::timeout(HANDSHAKE_TIMEOUT, read_packet(&mut reader)).await else {
        return;
    };
    let Ok(Frame::Hello { user_id, name, protocol }) = open(&noise, &packet) else { return };
    if protocol != PROTOCOL || session.verify(&user_id, &remote_key).is_none() {
        return;
    }
    let name = clip(name.trim(), MAX_NAME);

    // Register the connection. If the two apps connected to each other at the same moment, both
    // keep the one opened by the app with the smaller key, so exactly one survives.
    let connection = session.next_connection.fetch_add(1, Ordering::Relaxed);
    let opened_by = if initiator { session.public_key.clone() } else { remote_key.clone() };
    let (outbox, mut outgoing) = mpsc::unbounded_channel();
    let (close, mut closed) = oneshot::channel();
    {
        let mut peers = session.peers.lock().unwrap();
        if let Some(existing) = peers.get(&remote_key) {
            let keep_existing = existing.opened_by != opened_by && existing.opened_by < opened_by;
            if keep_existing {
                return;
            }
        }
        // Replacing an entry drops its close handle, which ends the older connection.
        peers.insert(
            remote_key.clone(),
            Peer { user_id: user_id.clone(), name, opened_by, connection, outbox: outbox.clone(), _close: close },
        );
    }
    session.emit_peers();
    for frame in session.backlog(&user_id) {
        let _ = outbox.send(frame);
    }

    // Reading runs on its own, since a half-read packet cannot be abandoned midway.
    let (incoming_tx, mut incoming) = mpsc::unbounded_channel();
    let reader_noise = noise.clone();
    let reading = tauri::async_runtime::spawn(async move {
        while let Ok(packet) = read_packet(&mut reader).await {
            let Ok(frame) = open(&reader_noise, &packet) else { break };
            if incoming_tx.send(frame).is_err() {
                break;
            }
        }
    });

    let mut stop = session.stop.subscribe();
    let mut ping = tokio::time::interval(PING_EVERY);
    let mut last_heard = Instant::now();
    loop {
        tokio::select! {
            frame = incoming.recv() => {
                let Some(frame) = frame else { break };
                last_heard = Instant::now();
                receive(&session, &user_id, &outbox, frame);
            }
            frame = outgoing.recv() => {
                let Some(frame) = frame else { break };
                let Ok(packet) = seal(&noise, &frame) else { break };
                if write_packet(&mut writer, &packet).await.is_err() {
                    break;
                }
            }
            _ = ping.tick() => {
                if last_heard.elapsed() > IDLE_LIMIT {
                    break;
                }
                let Ok(packet) = seal(&noise, &Frame::Ping) else { break };
                if write_packet(&mut writer, &packet).await.is_err() {
                    break;
                }
            }
            _ = stop.changed() => break,
            _ = &mut closed => break,
        }
    }
    reading.abort();
    let removed = {
        let mut peers = session.peers.lock().unwrap();
        let ours = peers.get(&remote_key).is_some_and(|peer| peer.connection == connection);
        if ours {
            peers.remove(&remote_key);
        }
        ours
    };
    if removed {
        session.emit_peers();
    }
}

/// Handles one frame from `from` (already verified).
fn receive(session: &Session, from: &str, outbox: &mpsc::UnboundedSender<Frame>, frame: Frame) {
    match frame {
        Frame::Message { id, to, name, body, sent_at } => {
            let chat = match to {
                None => ROOM.to_string(),
                // A direct message to me, from someone else.
                Some(to) if to == session.user_id && from != session.user_id => from.to_string(),
                _ => return,
            };
            let body = body.trim();
            if id.is_empty() || id.len() > 64 || body.is_empty() || body.chars().count() > MAX_BODY {
                return;
            }
            let item = LocalMessage {
                id: id.clone(),
                sender_id: from.to_string(),
                sender_name: clip(name.trim(), MAX_NAME),
                body: body.to_string(),
                sent_at,
                delivered: true,
                chat: chat.clone(),
            };
            if session.store(&item) {
                let _ = session.app.emit("local-chat-message", &item);
            }
            // Even a message already here is confirmed, since the sender may have missed the last ack.
            if chat != ROOM {
                let _ = outbox.send(Frame::Ack { id });
            }
        }
        Frame::Ack { id } => {
            let changed = {
                let db = session.db.lock().unwrap();
                db.execute(
                    "UPDATE messages SET delivered = 1 WHERE id = ?1 AND chat = ?2 AND sender_id = ?3 AND delivered = 0",
                    params![id, from, session.user_id],
                )
                .unwrap_or(0)
            };
            if changed > 0 {
                let _ = session.app.emit("local-chat-delivered", id);
            }
        }
        Frame::Hello { .. } | Frame::Ping => {}
    }
}

/// Connects to an app found on the network, unless it is already connected or being dialled.
fn dial(session: &Arc<Session>, key: String, addresses: Vec<SocketAddr>) {
    if key == session.public_key || session.peers.lock().unwrap().contains_key(&key) {
        return;
    }
    if !session.dialling.lock().unwrap().insert(key.clone()) {
        return;
    }
    let session = session.clone();
    tauri::async_runtime::spawn(async move {
        for address in addresses {
            if let Ok(Ok(stream)) = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(address)).await {
                // Dialling ends once this connection does, so it is not dialled twice meanwhile.
                run_connection(session.clone(), stream, true).await;
                break;
            }
        }
        session.dialling.lock().unwrap().remove(&key);
    });
}

async fn accept_loop(session: Arc<Session>, listener: TcpListener) {
    let mut stop = session.stop.subscribe();
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                if let Ok((stream, _)) = accepted {
                    tauri::async_runtime::spawn(run_connection(session.clone(), stream, false));
                }
            }
            _ = stop.changed() => break,
        }
    }
}

async fn discovery_loop(session: Arc<Session>, events: mdns_sd::Receiver<ServiceEvent>) {
    let mut stop = session.stop.subscribe();
    let mut retry = tokio::time::interval(RETRY_EVERY);
    loop {
        tokio::select! {
            event = events.recv_async() => match event {
                Ok(ServiceEvent::ServiceResolved(info)) => {
                    let Some(key) = info.get_property_val_str("key").map(str::to_string) else { continue };
                    let addresses: Vec<SocketAddr> = info
                        .get_addresses_v4()
                        .into_iter()
                        .map(|ip| SocketAddr::new(ip.into(), info.port))
                        .collect();
                    if addresses.is_empty() {
                        continue;
                    }
                    session.found.lock().unwrap().insert(
                        info.fullname.clone(),
                        Found { key: key.clone(), addresses: addresses.clone() },
                    );
                    dial(&session, key, addresses);
                }
                Ok(ServiceEvent::ServiceRemoved(_, fullname)) => {
                    session.found.lock().unwrap().remove(&fullname);
                }
                Ok(_) => {}
                Err(_) => break,
            },
            // A connection that failed or dropped is tried again while the app is still announced.
            _ = retry.tick() => {
                let found: Vec<(String, Vec<SocketAddr>)> = session
                    .found
                    .lock()
                    .unwrap()
                    .values()
                    .map(|found| (found.key.clone(), found.addresses.clone()))
                    .collect();
                for (key, addresses) in found {
                    dial(&session, key, addresses);
                }
            }
            _ = stop.changed() => break,
        }
    }
}

fn shut_down(session: &Session) {
    let _ = session.stop.send(true);
    let _ = session.mdns.unregister(&session.service_name);
    let _ = session.mdns.shutdown();
    session.peers.lock().unwrap().clear();
}

fn running(state: &LocalChat) -> Result<Arc<Session>, String> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Local chat is not running.".to_string())
}

// Commands ------------------------------------------------------------------------------------------

/// Starts Local chat for this account (or renames it if it is already running) and returns its
/// public key, for registering with the server while online.
#[tauri::command]
pub async fn local_chat_start(
    app: AppHandle,
    state: tauri::State<'_, LocalChat>,
    user_id: String,
    name: String,
) -> Result<String, String> {
    if !valid_user_id(&user_id) {
        return Err("That account id is not valid.".into());
    }
    let name = clip(name.trim(), MAX_NAME);
    let previous = state.0.lock().unwrap().take();
    if let Some(previous) = previous {
        if previous.user_id == user_id {
            *previous.name.lock().unwrap() = name;
            let key = previous.public_key.clone();
            *state.0.lock().unwrap() = Some(previous);
            return Ok(key);
        }
        shut_down(&previous);
    }

    let dir = account_dir(&app, &user_id)?;
    let (private_key, public_key) = load_keys(&dir)?;
    let public_key = to_hex(&public_key);
    let db = Connection::open(dir.join("chat.db")).map_err(message)?;
    db.execute_batch(SCHEMA).map_err(message)?;

    // Any free port; the mDNS announcement tells others which one.
    let listener = TcpListener::bind("0.0.0.0:0").await.map_err(message)?;
    let port = listener.local_addr().map_err(message)?.port();
    let mdns = ServiceDaemon::new().map_err(message)?;
    let instance = format!("novaroom-{}", &public_key[..16]);
    let service = ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &format!("{instance}.local."),
        "",
        port,
        &[("uid", user_id.as_str()), ("key", public_key.as_str()), ("v", "1")][..],
    )
    .map_err(message)?
    .enable_addr_auto();
    let service_name = service.get_fullname().to_string();
    mdns.register(service).map_err(message)?;
    let events = mdns.browse(SERVICE_TYPE).map_err(message)?;

    let (stop, _) = watch::channel(false);
    let session = Arc::new(Session {
        app,
        user_id,
        name: Mutex::new(name),
        private_key,
        public_key: public_key.clone(),
        db: Mutex::new(db),
        peers: Mutex::new(HashMap::new()),
        found: Mutex::new(HashMap::new()),
        dialling: Mutex::new(HashSet::new()),
        mdns,
        service_name,
        stop,
        next_connection: AtomicU64::new(0),
    });
    tauri::async_runtime::spawn(accept_loop(session.clone(), listener));
    tauri::async_runtime::spawn(discovery_loop(session.clone(), events));
    *state.0.lock().unwrap() = Some(session);
    Ok(public_key)
}

/// Stops Local chat, for example on signing out.
#[tauri::command]
pub fn local_chat_stop(state: tauri::State<'_, LocalChat>) {
    if let Some(session) = state.0.lock().unwrap().take() {
        shut_down(&session);
    }
}

/// Replaces the saved list of registered keys with a fresh one from the server.
#[tauri::command]
pub fn local_chat_set_directory(state: tauri::State<'_, LocalChat>, entries: Vec<DirectoryEntry>) -> Result<(), String> {
    let session = running(&state)?;
    let mut db = session.db.lock().unwrap();
    let tx = db.transaction().map_err(message)?;
    tx.execute("DELETE FROM directory", []).map_err(message)?;
    {
        let mut insert = tx
            .prepare("INSERT OR IGNORE INTO directory (user_id, public_key, name) VALUES (?1, ?2, ?3)")
            .map_err(message)?;
        for entry in &entries {
            insert
                .execute(params![entry.user_id, entry.public_key, clip(entry.name.trim(), MAX_NAME)])
                .map_err(message)?;
        }
    }
    tx.commit().map_err(message)
}

#[tauri::command]
pub fn local_chat_peers(state: tauri::State<'_, LocalChat>) -> Result<Vec<LocalPeer>, String> {
    Ok(running(&state)?.peer_list())
}

/// Chats with messages, newest first. Direct chats are named from the directory, or else from the
/// latest name the other person sent.
#[tauri::command]
pub fn local_chat_chats(state: tauri::State<'_, LocalChat>) -> Result<Vec<LocalChatSummary>, String> {
    let session = running(&state)?;
    let db = session.db.lock().unwrap();
    let mut statement = db
        .prepare(
            "SELECT m.chat, m.body, m.sent_at,
               COALESCE(
                 (SELECT d.name FROM directory d WHERE d.user_id = m.chat LIMIT 1),
                 (SELECT o.sender_name FROM messages o WHERE o.chat = m.chat AND o.sender_id = m.chat
                  ORDER BY o.sent_at DESC LIMIT 1),
                 ''
               )
             FROM messages m
             WHERE m.rowid = (SELECT l.rowid FROM messages l WHERE l.chat = m.chat ORDER BY l.sent_at DESC, l.rowid DESC LIMIT 1)
             ORDER BY m.sent_at DESC",
        )
        .map_err(message)?;
    let chats = statement
        .query_map([], |row| {
            Ok(LocalChatSummary {
                chat: row.get(0)?,
                last_body: row.get(1)?,
                last_at: row.get(2)?,
                name: row.get(3)?,
            })
        })
        .map_err(message)?
        .collect::<Result<_, _>>()
        .map_err(message)?;
    Ok(chats)
}

/// The latest messages of one chat, oldest first.
#[tauri::command]
pub fn local_chat_messages(state: tauri::State<'_, LocalChat>, chat: String) -> Result<Vec<LocalMessage>, String> {
    let session = running(&state)?;
    let db = session.db.lock().unwrap();
    let mut statement = db
        .prepare(
            "SELECT * FROM (
               SELECT id, chat, sender_id, sender_name, body, sent_at, delivered, rowid FROM messages
               WHERE chat = ?1 ORDER BY sent_at DESC, rowid DESC LIMIT ?2
             ) ORDER BY sent_at, rowid",
        )
        .map_err(message)?;
    let messages = statement
        .query_map(params![chat, CHAT_LIMIT], |row| {
            Ok(LocalMessage {
                id: row.get(0)?,
                chat: row.get(1)?,
                sender_id: row.get(2)?,
                sender_name: row.get(3)?,
                body: row.get(4)?,
                sent_at: row.get(5)?,
                delivered: row.get(6)?,
            })
        })
        .map_err(message)?
        .collect::<Result<_, _>>()
        .map_err(message)?;
    Ok(messages)
}

/// Saves a message and sends it to whoever is connected. A direct message to someone who is not
/// connected waits here until they are.
#[tauri::command]
pub fn local_chat_send(
    state: tauri::State<'_, LocalChat>,
    chat: String,
    id: String,
    body: String,
) -> Result<LocalMessage, String> {
    let session = running(&state)?;
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("Write a message first.".into());
    }
    if body.chars().count() > MAX_BODY {
        return Err(format!("Messages can be up to {MAX_BODY} characters."));
    }
    if id.is_empty() || id.len() > 64 {
        return Err("That message id is not valid.".into());
    }
    if chat != ROOM && (!valid_user_id(&chat) || chat == session.user_id) {
        return Err("That chat is not valid.".into());
    }
    let item = LocalMessage {
        id,
        sender_id: session.user_id.clone(),
        sender_name: session.name.lock().unwrap().clone(),
        body,
        sent_at: now_ms(),
        delivered: chat == ROOM,
        chat,
    };
    if !session.store(&item) {
        return Err("That message was already sent.".into());
    }
    let to = (item.chat != ROOM).then(|| item.chat.clone());
    let frame = || Frame::Message {
        id: item.id.clone(),
        to: to.clone(),
        name: item.sender_name.clone(),
        body: item.body.clone(),
        sent_at: item.sent_at,
    };
    session.send_to(to.as_deref(), frame);
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keypair() -> snow::Keypair {
        snow::Builder::new(NOISE_PARAMS.parse().unwrap()).generate_keypair().unwrap()
    }

    /// Two ends complete the handshake, learn each other's real public key, and exchange a frame.
    #[tokio::test]
    async fn handshake_and_frames() {
        let (alice, bob) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let bob_private = bob.private.clone();
        let responder = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (mut reader, mut writer) = stream.into_split();
            let noise = handshake(&bob_private, &mut reader, &mut writer, false).await.unwrap();
            let remote = noise.get_remote_static().unwrap().to_vec();
            let noise = Mutex::new(noise);
            let frame = open(&noise, &read_packet(&mut reader).await.unwrap()).unwrap();
            let packet = seal(&noise, &Frame::Ack { id: "m1".into() }).unwrap();
            write_packet(&mut writer, &packet).await.unwrap();
            (remote, frame)
        });

        let (mut reader, mut writer) = TcpStream::connect(address).await.unwrap().into_split();
        let noise = handshake(&alice.private, &mut reader, &mut writer, true).await.unwrap();
        assert_eq!(noise.get_remote_static().unwrap(), bob.public.as_slice());
        let noise = Mutex::new(noise);
        let hello = Frame::Message { id: "m1".into(), to: None, name: "Alice".into(), body: "Hi".into(), sent_at: 1 };
        write_packet(&mut writer, &seal(&noise, &hello).unwrap()).await.unwrap();
        let reply = open(&noise, &read_packet(&mut reader).await.unwrap()).unwrap();
        assert!(matches!(reply, Frame::Ack { id } if id == "m1"));

        let (remote, frame) = responder.await.unwrap();
        assert_eq!(remote, alice.public);
        assert!(matches!(frame, Frame::Message { body, to: None, .. } if body == "Hi"));
    }

    /// A key from a different Noise setup (no shared prologue) cannot complete the handshake.
    #[tokio::test]
    async fn rejects_other_programs() {
        let (alice, bob) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let responder = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (mut reader, mut writer) = stream.into_split();
            handshake(&bob.private, &mut reader, &mut writer, false).await.is_ok()
        });
        let (mut reader, mut writer) = TcpStream::connect(address).await.unwrap().into_split();
        let mut other = snow::Builder::new(NOISE_PARAMS.parse().unwrap())
            .local_private_key(&alice.private)
            .unwrap()
            .build_initiator()
            .unwrap();
        let mut buffer = vec![0u8; NOISE_MAX];
        let length = other.write_message(&[], &mut buffer).unwrap();
        write_packet(&mut writer, &buffer[..length]).await.unwrap();
        let packet = read_packet(&mut reader).await.unwrap();
        let mut payload = vec![0u8; NOISE_MAX];
        // The responder mixed in the prologue, so its reply does not decrypt here.
        assert!(other.read_message(&packet, &mut payload).is_err());
        drop(writer);
        assert!(!responder.await.unwrap());
    }

    #[test]
    fn account_ids_are_checked() {
        assert!(valid_user_id("6f1c2a9e-1b2c-4d5e-8f90-123456789abc"));
        assert!(!valid_user_id("../other"));
        assert!(!valid_user_id(""));
    }
}
