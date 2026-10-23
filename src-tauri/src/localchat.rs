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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
/// Largest file someone can send, as in the app's other chats.
const MAX_FILE: u64 = 25 * 1024 * 1024;
const MAX_FILE_NAME: usize = 200;
/// File bytes per FileChunk frame. Base64 makes them a third bigger, which still fits one packet.
const FILE_CHUNK: usize = 32 * 1024;
/// What this app understands beyond the first version, listed in Hello. Each kind of frame only
/// goes to apps that listed it, since older apps drop the connection on frames they do not know.
const FEATURE_TYPING: &str = "typing";
const FEATURE_READ: &str = "read";
const FEATURE_FILES: &str = "files";
const FEATURES: &[&str] = &[FEATURE_TYPING, FEATURE_READ, FEATURE_FILES];
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
-- How far this person has read each direct chat (the newest sent_at they have seen), so the other
-- person can be told again after reconnecting.
CREATE TABLE IF NOT EXISTS reads (
  chat TEXT PRIMARY KEY,
  up_to INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS directory (
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (user_id, public_key)
);
";

/// Columns added to `messages` after the first version, added to older files on start.
const ADDED_COLUMNS: &[(&str, &str)] = &[
    ("reply_to", "TEXT"),
    ("file_name", "TEXT"),
    ("file_mime", "TEXT"),
    ("file_size", "INTEGER"),
    // 'ready' (file_path has it), 'waiting' (still to come from the sender) or 'missing'.
    ("file_state", "TEXT"),
    ("file_path", "TEXT"),
    // Own direct messages: whether the other person has seen it.
    ("read", "INTEGER NOT NULL DEFAULT 0"),
];

fn migrate(db: &Connection) -> Result<(), String> {
    db.execute_batch(SCHEMA).map_err(message)?;
    let existing: HashSet<String> = db
        .prepare("PRAGMA table_info(messages)")
        .map_err(message)?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(message)?
        .filter_map(Result::ok)
        .collect();
    for (name, kind) in ADDED_COLUMNS {
        if !existing.contains(*name) {
            db.execute_batch(&format!("ALTER TABLE messages ADD COLUMN {name} {kind}"))
                .map_err(message)?;
        }
    }
    // Profile pictures came later than the directory itself.
    let has_avatar = db
        .prepare("PRAGMA table_info(directory)")
        .map_err(message)?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(message)?
        .filter_map(Result::ok)
        .any(|column| column == "avatar_url");
    if !has_avatar {
        db.execute_batch("ALTER TABLE directory ADD COLUMN avatar_url TEXT").map_err(message)?;
    }
    Ok(())
}

/// A file as it travels in a Message frame.
#[derive(Serialize, Deserialize, Clone)]
struct FileInfo {
    name: String,
    mime: String,
    size: u64,
}

/// A message's file as the app shows it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalFile {
    name: String,
    mime: String,
    size: u64,
    /// "ready", "waiting" (still coming from the sender) or "missing" (the sender no longer has it).
    state: String,
}

/// The message a reply answers, shown above it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReplyPreview {
    id: String,
    sender_id: String,
    sender_name: String,
    body: String,
    file_name: Option<String>,
}

/// A message as the app shows it. `chat` is from this computer's point of view: "room", or the
/// other person's id in a direct chat, whichever of the two sent it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalMessage {
    id: String,
    chat: String,
    sender_id: String,
    sender_name: String,
    /// Empty when the message is only a file.
    body: String,
    /// Milliseconds since 1970, by the sender's clock.
    sent_at: i64,
    /// Own direct messages: whether the other person's app has it. Always true for room messages.
    delivered: bool,
    /// Own direct messages: whether the other person has seen it.
    read: bool,
    /// The answered message, if it is on this computer. Filled in when reading from the file.
    reply_to: Option<ReplyPreview>,
    file: Option<LocalFile>,
    #[serde(skip)]
    reply_to_id: Option<String>,
    #[serde(skip)]
    file_path: Option<String>,
}

const MESSAGE_SELECT: &str = "SELECT m.id, m.chat, m.sender_id, m.sender_name, m.body, m.sent_at, m.delivered,
       m.read, m.reply_to, m.file_name, m.file_mime, m.file_size, m.file_state, m.file_path,
       r.sender_id, r.sender_name, r.body, r.file_name
     FROM messages m LEFT JOIN messages r ON r.id = m.reply_to";

fn message_row(row: &rusqlite::Row) -> rusqlite::Result<LocalMessage> {
    let reply_to_id: Option<String> = row.get(8)?;
    let file_name: Option<String> = row.get(9)?;
    let reply_sender: Option<String> = row.get(14)?;
    Ok(LocalMessage {
        id: row.get(0)?,
        chat: row.get(1)?,
        sender_id: row.get(2)?,
        sender_name: row.get(3)?,
        body: row.get(4)?,
        sent_at: row.get(5)?,
        delivered: row.get(6)?,
        read: row.get(7)?,
        reply_to: match (&reply_to_id, reply_sender) {
            (Some(id), Some(sender_id)) => Some(ReplyPreview {
                id: id.clone(),
                sender_id,
                sender_name: row.get(15)?,
                body: clip(&row.get::<_, String>(16)?, 200),
                file_name: row.get(17)?,
            }),
            _ => None,
        },
        file: match file_name {
            Some(name) => Some(LocalFile {
                name,
                mime: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                size: row.get::<_, Option<i64>>(11)?.unwrap_or(0).max(0) as u64,
                state: row.get::<_, Option<String>>(12)?.unwrap_or_else(|| "missing".into()),
            }),
            None => None,
        },
        reply_to_id,
        file_path: row.get(13)?,
    })
}

/// Someone whose app is connected right now.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalPeer {
    user_id: String,
    name: String,
    /// No keyboard or mouse input on any of their computers for a while. Apps from before idle
    /// status was shared never say, so they always count as active.
    idle: bool,
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
    /// The profile picture's address. It only loads while online; the app shows initials otherwise.
    #[serde(default)]
    avatar_url: Option<String>,
}

/// What two apps send each other, as JSON inside encrypted Noise messages.
#[derive(Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
enum Frame {
    /// `idle` is left out by apps from before idle status was shared, which would drop the
    /// connection on a Status frame. Sending it at all says the app understands Status frames.
    #[serde(rename_all = "camelCase")]
    Hello {
        user_id: String,
        name: String,
        protocol: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        idle: Option<bool>,
        /// Which of FEATURES the app understands; empty for older apps.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        features: Vec<String>,
    },
    /// The sender is whoever is on the other end of the connection, never a field, so nobody can
    /// send a message in someone else's name. `to` is the recipient's id, or none for the room.
    /// Older apps ignore `reply_to` and `file`; they never get a file, see `message_frame`.
    #[serde(rename_all = "camelCase")]
    Message {
        id: String,
        to: Option<String>,
        name: String,
        body: String,
        sent_at: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reply_to: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file: Option<FileInfo>,
    },
    Ack { id: String },
    Ping,
    /// The sender's idle status changed. Only sent to apps that said they understand it.
    Status { idle: bool },
    /// The sender started or stopped typing in the room (no `to`) or to `to`. Needs "typing".
    Typing { to: Option<String>, typing: bool },
    /// The sender has seen my direct messages to them up to this sent_at. Needs "read".
    #[serde(rename_all = "camelCase")]
    Read { up_to: i64 },
    /// Asks the sender of a message for its file, which comes back as FileChunks. Needs "files".
    FileRequest { id: String },
    FileChunk { id: String, offset: u64, data: String },
    /// The file of message `id` can't be sent any more.
    FileMissing { id: String },
}

struct Peer {
    user_id: String,
    name: String,
    /// The public key of the app that opened this connection, to pick one when two apps connect
    /// to each other at the same moment.
    opened_by: String,
    connection: u64,
    outbox: mpsc::UnboundedSender<Frame>,
    idle: bool,
    /// Whether the app sent its idle status in Hello, and so can be sent Status frames.
    shares_status: bool,
    features: HashSet<String>,
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
    /// Whether this person is idle, as the window last said.
    idle: AtomicBool,
    /// Files sent and received, one folder per message id.
    files_dir: PathBuf,
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

/// A file name that is safe to save on Windows, keeping as much of the original as possible.
fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let cleaned = clip(cleaned.trim().trim_end_matches(['.', ' ']), MAX_FILE_NAME);
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")));
    match cleaned.as_str() {
        "" => "file".into(),
        _ if reserved => format!("_{cleaned}"),
        _ => cleaned,
    }
}

/// The Message frame for one of this person's messages, as `features` can read it. Apps without
/// file support get a line about the file instead, so the message still makes sense to them.
fn message_frame(item: &LocalMessage, features: &HashSet<String>) -> Frame {
    let files = features.contains(FEATURE_FILES);
    let mut body = item.body.clone();
    if let (Some(file), false) = (&item.file, files) {
        let note = format!("[File: {} - update Novaroom to open it]", file.name);
        body = if body.is_empty() { note } else { format!("{body}\n{note}") };
    }
    Frame::Message {
        id: item.id.clone(),
        to: (item.chat != ROOM).then(|| item.chat.clone()),
        name: item.sender_name.clone(),
        body,
        sent_at: item.sent_at,
        reply_to: item.reply_to_id.clone(),
        file: item
            .file
            .as_ref()
            .filter(|_| files)
            .map(|file| FileInfo { name: file.name.clone(), mime: file.mime.clone(), size: file.size }),
    }
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
            idle: self.idle.load(Ordering::Relaxed),
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

    /// Everyone connected, once each, without this person's own other computers. Someone on
    /// several computers is idle only if all of them are.
    fn peer_list(&self) -> Vec<LocalPeer> {
        let peers = self.peers.lock().unwrap();
        let mut people: HashMap<&str, LocalPeer> = HashMap::new();
        for peer in peers.values().filter(|peer| peer.user_id != self.user_id) {
            people
                .entry(&peer.user_id)
                .and_modify(|person| person.idle &= peer.idle)
                .or_insert_with(|| LocalPeer {
                    user_id: peer.user_id.clone(),
                    name: peer.name.clone(),
                    idle: peer.idle,
                });
        }
        let mut list: Vec<LocalPeer> = people.into_values().collect();
        list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        list
    }

    fn emit_peers(&self) {
        let _ = self.app.emit("local-chat-peers", self.peer_list());
    }

    /// Saves a message unless it is already here. True if it was new.
    fn store(&self, item: &LocalMessage) -> bool {
        let db = self.db.lock().unwrap();
        let file = item.file.as_ref();
        db.execute(
            "INSERT OR IGNORE INTO messages
               (id, chat, sender_id, sender_name, body, sent_at, delivered, read, reply_to,
                file_name, file_mime, file_size, file_state, file_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                item.id,
                item.chat,
                item.sender_id,
                item.sender_name,
                item.body,
                item.sent_at,
                item.delivered,
                item.reply_to_id,
                file.map(|file| file.name.clone()),
                file.map(|file| file.mime.clone()),
                file.map(|file| file.size as i64),
                file.map(|file| file.state.clone()),
                item.file_path,
            ],
        )
        .map(|changed| changed > 0)
        .unwrap_or(false)
    }

    /// One message as the app shows it, with what it replies to.
    fn message(&self, id: &str) -> Option<LocalMessage> {
        let db = self.db.lock().unwrap();
        db.query_row(&format!("{MESSAGE_SELECT} WHERE m.id = ?1"), params![id], message_row)
            .ok()
    }

    fn messages(&self, filter: &str, args: &[&dyn rusqlite::ToSql]) -> Vec<LocalMessage> {
        let db = self.db.lock().unwrap();
        let Ok(mut statement) = db.prepare(&format!("{MESSAGE_SELECT} {filter}")) else { return Vec::new() };
        statement
            .query_map(args, message_row)
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    }

    /// What to send someone who has just connected: this person's recent room messages, their
    /// direct messages to them that are still waiting, how far I have read their messages, and
    /// requests for their files that have not arrived yet.
    fn backlog(&self, peer_user_id: &str, features: &HashSet<String>) -> Vec<Frame> {
        let since = now_ms() - ROOM_HISTORY_MS;
        let mut room = self.messages(
            "WHERE m.chat = ?1 AND m.sender_id = ?2 AND m.sent_at > ?3 ORDER BY m.sent_at DESC LIMIT ?4",
            &[&ROOM, &self.user_id, &since, &ROOM_HISTORY_LIMIT],
        );
        room.reverse();
        let mut frames: Vec<Frame> = room.iter().map(|item| message_frame(item, features)).collect();
        // My other computers keep their own direct chats; they only share the room.
        if peer_user_id != self.user_id {
            let waiting = self.messages(
                "WHERE m.chat = ?1 AND m.sender_id = ?2 AND m.delivered = 0 ORDER BY m.sent_at",
                &[&peer_user_id, &self.user_id],
            );
            frames.extend(waiting.iter().map(|item| message_frame(item, features)));
            if features.contains(FEATURE_READ) {
                let db = self.db.lock().unwrap();
                let up_to: Option<i64> = db
                    .query_row("SELECT up_to FROM reads WHERE chat = ?1", params![peer_user_id], |row| row.get(0))
                    .ok();
                frames.extend(up_to.map(|up_to| Frame::Read { up_to }));
            }
        }
        if features.contains(FEATURE_FILES) {
            let ids: Vec<String> = {
                let db = self.db.lock().unwrap();
                let statement = db.prepare(
                    "SELECT id FROM messages
                     WHERE sender_id = ?1 AND file_state = 'waiting' AND (chat = ?2 OR chat = ?1)",
                );
                match statement {
                    Ok(mut statement) => statement
                        .query_map(params![peer_user_id, ROOM], |row| row.get(0))
                        .map(|rows| rows.filter_map(Result::ok).collect())
                        .unwrap_or_default(),
                    Err(_) => Vec::new(),
                }
            };
            frames.extend(ids.into_iter().map(|id| Frame::FileRequest { id }));
        }
        frames
    }

    /// Records a connected app's new idle status and tells the window if it changed.
    fn set_peer_idle(&self, key: &str, connection: u64, idle: bool) {
        let changed = {
            let mut peers = self.peers.lock().unwrap();
            match peers.get_mut(key) {
                Some(peer) if peer.connection == connection && peer.idle != idle => {
                    peer.idle = idle;
                    true
                }
                _ => false,
            }
        };
        if changed {
            self.emit_peers();
        }
    }

    /// Hands a frame to every connection for these people (all of them for the room), as each
    /// can read it; None skips that connection.
    fn send_to(&self, user_id: Option<&str>, frame_for: impl Fn(&Peer) -> Option<Frame>) {
        let peers = self.peers.lock().unwrap();
        for peer in peers.values() {
            if user_id.is_none_or(|id| id == peer.user_id) {
                if let Some(frame) = frame_for(peer) {
                    let _ = peer.outbox.send(frame);
                }
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

fn decrypt(noise: &Mutex<snow::TransportState>, packet: &[u8]) -> Result<Vec<u8>, String> {
    let mut json = vec![0u8; packet.len()];
    let length = noise.lock().unwrap().read_message(packet, &mut json).map_err(message)?;
    json.truncate(length);
    Ok(json)
}

fn open(noise: &Mutex<snow::TransportState>, packet: &[u8]) -> Result<Frame, String> {
    serde_json::from_slice(&decrypt(noise, packet)?).map_err(message)
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
    let hello = Frame::Hello {
        user_id: me.user_id,
        name: me.name,
        protocol: PROTOCOL,
        idle: Some(me.idle),
        features: FEATURES.iter().map(|feature| feature.to_string()).collect(),
    };
    let Ok(packet) = seal(&noise, &hello) else { return };
    if write_packet(&mut writer, &packet).await.is_err() {
        return;
    }
    let Ok(Ok(packet)) = tokio::time::timeout(HANDSHAKE_TIMEOUT, read_packet(&mut reader)).await else {
        return;
    };
    let Ok(Frame::Hello { user_id, name, protocol, idle, features }) = open(&noise, &packet) else { return };
    let features: HashSet<String> = features.into_iter().take(32).filter(|feature| feature.len() <= 32).collect();
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
            Peer {
                user_id: user_id.clone(),
                name,
                opened_by,
                connection,
                outbox: outbox.clone(),
                idle: idle.unwrap_or(false),
                shares_status: idle.is_some(),
                features: features.clone(),
                _close: close,
            },
        );
    }
    session.emit_peers();
    for frame in session.backlog(&user_id, &features) {
        let _ = outbox.send(frame);
    }

    // Reading runs on its own, since a half-read packet cannot be abandoned midway.
    let (incoming_tx, mut incoming) = mpsc::unbounded_channel();
    let reader_noise = noise.clone();
    let reading = tauri::async_runtime::spawn(async move {
        while let Ok(packet) = read_packet(&mut reader).await {
            let Ok(json) = decrypt(&reader_noise, &packet) else { break };
            // A frame from a newer app that this one does not know is skipped, not a broken connection.
            let Ok(frame) = serde_json::from_slice::<Frame>(&json) else { continue };
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
                if let Frame::Status { idle } = frame {
                    session.set_peer_idle(&remote_key, connection, idle);
                } else {
                    receive(&session, &user_id, &outbox, frame);
                }
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

/// Something the window shows about a chat: someone typing, or how far they have read.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TypingEvent {
    chat: String,
    user_id: String,
    typing: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReadEvent {
    chat: String,
    up_to: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileEvent {
    id: String,
    state: String,
}

/// Handles one frame from `from` (already verified).
fn receive(session: &Session, from: &str, outbox: &mpsc::UnboundedSender<Frame>, frame: Frame) {
    match frame {
        Frame::Message { id, to, name, body, sent_at, reply_to, file } => {
            let chat = match to {
                None => ROOM.to_string(),
                // A direct message to me, from someone else.
                Some(to) if to == session.user_id && from != session.user_id => from.to_string(),
                _ => return,
            };
            let body = body.trim();
            // Ids become folder names for files, so they must look like real ids.
            if !valid_user_id(&id) || (body.is_empty() && file.is_none()) || body.chars().count() > MAX_BODY {
                return;
            }
            let file = file.filter(|file| file.size <= MAX_FILE).map(|file| LocalFile {
                name: safe_file_name(&file.name),
                mime: clip(file.mime.trim(), 100),
                size: file.size,
                state: "waiting".into(),
            });
            let wants_file = file.is_some();
            let item = LocalMessage {
                id: id.clone(),
                sender_id: from.to_string(),
                sender_name: clip(name.trim(), MAX_NAME),
                body: body.to_string(),
                sent_at,
                delivered: true,
                read: false,
                reply_to: None,
                file,
                reply_to_id: reply_to.filter(|reply| valid_user_id(reply)),
                file_path: None,
                chat: chat.clone(),
            };
            if session.store(&item) {
                if let Some(stored) = session.message(&id) {
                    let _ = session.app.emit("local-chat-message", &stored);
                }
                if wants_file {
                    let _ = outbox.send(Frame::FileRequest { id: id.clone() });
                }
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
        Frame::Typing { to, typing } => {
            let chat = match to {
                None => ROOM.to_string(),
                Some(to) if to == session.user_id && from != session.user_id => from.to_string(),
                _ => return,
            };
            if from != session.user_id {
                let event = TypingEvent { chat, user_id: from.to_string(), typing };
                let _ = session.app.emit("local-chat-typing", event);
            }
        }
        Frame::Read { up_to } => {
            if from == session.user_id {
                return;
            }
            let changed = {
                let db = session.db.lock().unwrap();
                db.execute(
                    "UPDATE messages SET read = 1, delivered = 1
                     WHERE chat = ?1 AND sender_id = ?2 AND sent_at <= ?3 AND read = 0",
                    params![from, session.user_id, up_to],
                )
                .unwrap_or(0)
            };
            if changed > 0 {
                let _ = session.app.emit("local-chat-read", ReadEvent { chat: from.to_string(), up_to });
            }
        }
        Frame::FileRequest { id } => send_file(session, from, outbox, id),
        Frame::FileChunk { id, offset, data } => receive_chunk(session, from, &id, offset, &data),
        Frame::FileMissing { id } => {
            let changed = {
                let db = session.db.lock().unwrap();
                db.execute(
                    "UPDATE messages SET file_state = 'missing' WHERE id = ?1 AND sender_id = ?2 AND file_state = 'waiting'",
                    params![id, from],
                )
                .unwrap_or(0)
            };
            if changed > 0 {
                let _ = session.app.emit("local-chat-file", FileEvent { id, state: "missing".into() });
            }
        }
        // Status needs the connection, so the connection loop handles it.
        Frame::Hello { .. } | Frame::Ping | Frame::Status { .. } => {}
    }
}

/// Sends the file of one of my messages to `to`, if they may have it: anyone for the room, only
/// the other person for a direct chat.
fn send_file(session: &Session, to: &str, outbox: &mpsc::UnboundedSender<Frame>, id: String) {
    use base64::Engine;
    let path: Option<String> = {
        let db = session.db.lock().unwrap();
        db.query_row(
            "SELECT file_path FROM messages
             WHERE id = ?1 AND sender_id = ?2 AND file_state = 'ready' AND (chat = ?3 OR chat = ?4)",
            params![id, session.user_id, ROOM, to],
            |row| row.get(0),
        )
        .ok()
        .flatten()
    };
    let Some(bytes) = path.and_then(|path| std::fs::read(path).ok()) else {
        let _ = outbox.send(Frame::FileMissing { id });
        return;
    };
    for (index, chunk) in bytes.chunks(FILE_CHUNK).enumerate() {
        let data = base64::engine::general_purpose::STANDARD.encode(chunk);
        let _ = outbox.send(Frame::FileChunk { id: id.clone(), offset: (index * FILE_CHUNK) as u64, data });
    }
}

/// Adds one piece of a file someone sent. Pieces arrive in order on one connection; anything else
/// (a gap, a file nobody asked for) is ignored.
fn receive_chunk(session: &Session, from: &str, id: &str, offset: u64, data: &str) {
    use base64::Engine;
    use std::io::Write;
    let expected: Option<(String, i64)> = {
        let db = session.db.lock().unwrap();
        db.query_row(
            "SELECT file_name, file_size FROM messages WHERE id = ?1 AND sender_id = ?2 AND file_state = 'waiting'",
            params![id, from],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok()
    };
    let Some((name, size)) = expected else { return };
    let size = size.max(0) as u64;
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data) else { return };
    if !valid_user_id(id) || offset + bytes.len() as u64 > size {
        return;
    }
    let folder = session.files_dir.join(id);
    if std::fs::create_dir_all(&folder).is_err() {
        return;
    }
    let part = folder.join("download.part");
    let opened = if offset == 0 {
        std::fs::File::create(&part)
    } else {
        std::fs::OpenOptions::new().append(true).open(&part)
    };
    let Ok(mut file) = opened else { return };
    if file.metadata().map(|meta| meta.len()).unwrap_or(u64::MAX) != offset || file.write_all(&bytes).is_err() {
        return;
    }
    drop(file);
    if offset + bytes.len() as u64 != size {
        return;
    }
    let path = folder.join(safe_file_name(&name));
    if std::fs::rename(&part, &path).is_err() {
        return;
    }
    {
        let db = session.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE messages SET file_state = 'ready', file_path = ?2 WHERE id = ?1",
            params![id, path.to_string_lossy()],
        );
    }
    let _ = session.app.emit("local-chat-file", FileEvent { id: id.to_string(), state: "ready".into() });
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
    migrate(&db)?;
    let files_dir = dir.join("files");

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
        idle: AtomicBool::new(false),
        files_dir,
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
            .prepare("INSERT OR IGNORE INTO directory (user_id, public_key, name, avatar_url) VALUES (?1, ?2, ?3, ?4)")
            .map_err(message)?;
        for entry in &entries {
            let avatar = entry.avatar_url.as_deref().filter(|url| url.starts_with("https://") && url.len() <= 1000);
            insert
                .execute(params![entry.user_id, entry.public_key, clip(entry.name.trim(), MAX_NAME), avatar])
                .map_err(message)?;
        }
    }
    tx.commit().map_err(message)
}

/// Shares whether this person is idle with everyone connected whose app understands it.
#[tauri::command]
pub fn local_chat_set_idle(state: tauri::State<'_, LocalChat>, idle: bool) -> Result<(), String> {
    let session = running(&state)?;
    if session.idle.swap(idle, Ordering::Relaxed) == idle {
        return Ok(());
    }
    let peers = session.peers.lock().unwrap();
    for peer in peers.values().filter(|peer| peer.shares_status) {
        let _ = peer.outbox.send(Frame::Status { idle });
    }
    Ok(())
}

/// Everyone's profile picture address from the saved directory, by account id.
#[tauri::command]
pub fn local_chat_avatars(state: tauri::State<'_, LocalChat>) -> Result<HashMap<String, String>, String> {
    let session = running(&state)?;
    let db = session.db.lock().unwrap();
    let mut statement = db
        .prepare("SELECT user_id, MAX(avatar_url) FROM directory WHERE avatar_url IS NOT NULL GROUP BY user_id")
        .map_err(message)?;
    let avatars = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(message)?
        .filter_map(Result::ok)
        .collect();
    Ok(avatars)
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
            "SELECT m.chat, COALESCE(NULLIF(m.body, ''), m.file_name, ''), m.sent_at,
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
    let mut messages = session.messages(
        "WHERE m.chat = ?1 ORDER BY m.sent_at DESC, m.rowid DESC LIMIT ?2",
        &[&chat, &CHAT_LIMIT],
    );
    messages.reverse();
    Ok(messages)
}

/// A file to send with a message, already handed over with `local_chat_stage_file`.
#[derive(Deserialize)]
pub struct OutgoingFile {
    name: String,
    mime: String,
}

/// Where a file waits between `local_chat_stage_file` and `local_chat_send`.
fn staged_path(session: &Session, id: &str) -> PathBuf {
    session.files_dir.join(id).join("upload.part")
}

/// Takes the bytes of a file to send (the request body), for the message with id `x-id`.
#[tauri::command]
pub async fn local_chat_stage_file(
    state: tauri::State<'_, LocalChat>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let session = running(&state)?;
    let id = request
        .headers()
        .get("x-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !valid_user_id(&id) {
        return Err("That message id is not valid.".into());
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("No file was sent.".into());
    };
    if bytes.len() as u64 > MAX_FILE {
        return Err(format!("Files can be up to {} MB.", MAX_FILE / 1024 / 1024));
    }
    let path = staged_path(&session, &id);
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder).map_err(message)?;
    }
    std::fs::write(path, bytes).map_err(message)
}

/// Saves a message and sends it to whoever is connected. A direct message to someone who is not
/// connected waits here until they are. A file has to be staged first under the same id.
#[tauri::command]
pub fn local_chat_send(
    state: tauri::State<'_, LocalChat>,
    chat: String,
    id: String,
    body: String,
    reply_to: Option<String>,
    file: Option<OutgoingFile>,
) -> Result<LocalMessage, String> {
    let session = running(&state)?;
    let body = body.trim().to_string();
    if body.is_empty() && file.is_none() {
        return Err("Write a message first.".into());
    }
    if body.chars().count() > MAX_BODY {
        return Err(format!("Messages can be up to {MAX_BODY} characters."));
    }
    if !valid_user_id(&id) {
        return Err("That message id is not valid.".into());
    }
    if chat != ROOM && (!valid_user_id(&chat) || chat == session.user_id) {
        return Err("That chat is not valid.".into());
    }
    let (file, file_path) = match file {
        Some(file) => {
            let staged = staged_path(&session, &id);
            let size = std::fs::metadata(&staged).map_err(|_| "Add the file again.".to_string())?.len();
            let name = safe_file_name(&file.name);
            let path = session.files_dir.join(&id).join(&name);
            std::fs::rename(&staged, &path).map_err(message)?;
            let shown = LocalFile { name, mime: clip(file.mime.trim(), 100), size, state: "ready".into() };
            (Some(shown), Some(path.to_string_lossy().into_owned()))
        }
        None => (None, None),
    };
    let item = LocalMessage {
        id: id.clone(),
        sender_id: session.user_id.clone(),
        sender_name: session.name.lock().unwrap().clone(),
        body,
        sent_at: now_ms(),
        delivered: chat == ROOM,
        read: false,
        reply_to: None,
        file,
        reply_to_id: reply_to.filter(|reply| valid_user_id(reply)),
        file_path,
        chat,
    };
    if !session.store(&item) {
        return Err("That message was already sent.".into());
    }
    let to = (item.chat != ROOM).then(|| item.chat.clone());
    session.send_to(to.as_deref(), |peer| Some(message_frame(&item, &peer.features)));
    Ok(session.message(&id).unwrap_or(item))
}

/// The bytes of a message's file, for showing an image.
#[tauri::command]
pub async fn local_chat_file(state: tauri::State<'_, LocalChat>, id: String) -> Result<tauri::ipc::Response, String> {
    let session = running(&state)?;
    let path = session
        .message(&id)
        .filter(|item| item.file.as_ref().is_some_and(|file| file.state == "ready"))
        .and_then(|item| item.file_path)
        .ok_or("That file is not on this computer.")?;
    let bytes = std::fs::read(path).map_err(|_| "That file is not on this computer any more.".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Asks where to save a message's file and copies it there. False if the person cancelled.
#[tauri::command]
pub async fn local_chat_save_file(
    app: AppHandle,
    state: tauri::State<'_, LocalChat>,
    id: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let session = running(&state)?;
    let item = session.message(&id).ok_or("That message is not on this computer.")?;
    let (Some(file), Some(source)) = (item.file, item.file_path) else {
        return Err("That file is not on this computer.".into());
    };
    let picked = app.dialog().file().set_title("Save file").set_file_name(&file.name).blocking_save_file();
    let Some(picked) = picked else { return Ok(false) };
    let target = picked.into_path().map_err(message)?;
    std::fs::copy(source, target).map_err(message)?;
    Ok(true)
}

/// Tells the room, or the other person in a direct chat, that this person started or stopped typing.
#[tauri::command]
pub fn local_chat_typing(state: tauri::State<'_, LocalChat>, chat: String, typing: bool) -> Result<(), String> {
    let session = running(&state)?;
    let to = (chat != ROOM).then_some(chat);
    session.send_to(to.as_deref(), |peer| {
        peer.features.contains(FEATURE_TYPING).then(|| Frame::Typing { to: to.clone(), typing })
    });
    Ok(())
}

/// Records that this person has seen a direct chat up to its newest message from the other
/// person, and tells them so their double checks show.
#[tauri::command]
pub fn local_chat_mark_read(state: tauri::State<'_, LocalChat>, chat: String) -> Result<(), String> {
    let session = running(&state)?;
    if chat == ROOM || !valid_user_id(&chat) {
        return Ok(());
    }
    let up_to = {
        let db = session.db.lock().unwrap();
        let newest: Option<i64> = db
            .query_row(
                "SELECT MAX(sent_at) FROM messages WHERE chat = ?1 AND sender_id = ?1",
                params![chat],
                |row| row.get(0),
            )
            .map_err(message)?;
        let Some(newest) = newest else { return Ok(()) };
        let before: Option<i64> = db
            .query_row("SELECT up_to FROM reads WHERE chat = ?1", params![chat], |row| row.get(0))
            .ok();
        if before.is_some_and(|before| before >= newest) {
            return Ok(());
        }
        db.execute(
            "INSERT INTO reads (chat, up_to) VALUES (?1, ?2) ON CONFLICT (chat) DO UPDATE SET up_to = excluded.up_to",
            params![chat, newest],
        )
        .map_err(message)?;
        newest
    };
    session.send_to(Some(&chat), |peer| {
        peer.features.contains(FEATURE_READ).then_some(Frame::Read { up_to })
    });
    Ok(())
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
        let hello = Frame::Message {
            id: "m1".into(),
            to: None,
            name: "Alice".into(),
            body: "Hi".into(),
            sent_at: 1,
            reply_to: None,
            file: None,
        };
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
    fn file_names_are_made_safe() {
        assert_eq!(safe_file_name("report.pdf"), "report.pdf");
        assert_eq!(safe_file_name("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(safe_file_name("a<b>:c?.txt"), "a_b__c_.txt");
        assert_eq!(safe_file_name("CON.txt"), "_CON.txt");
        assert_eq!(safe_file_name("..."), "file");
    }

    /// Apps from before features existed, and newer apps with fields this one lacks, still parse.
    #[test]
    fn frames_from_other_versions() {
        let old = r#"{"t":"hello","userId":"u1","name":"A","protocol":1}"#;
        assert!(matches!(
            serde_json::from_str::<Frame>(old).unwrap(),
            Frame::Hello { idle: None, features, .. } if features.is_empty()
        ));
        let newer = r#"{"t":"message","id":"m1","to":null,"name":"A","body":"Hi","sentAt":1,"later":true}"#;
        assert!(matches!(
            serde_json::from_str::<Frame>(newer).unwrap(),
            Frame::Message { reply_to: None, file: None, .. }
        ));
        let mut plain = HashSet::new();
        let item = LocalMessage {
            id: "m2".into(),
            chat: ROOM.into(),
            sender_id: "u1".into(),
            sender_name: "A".into(),
            body: String::new(),
            sent_at: 1,
            delivered: true,
            read: false,
            reply_to: None,
            file: Some(LocalFile { name: "a.png".into(), mime: "image/png".into(), size: 3, state: "ready".into() }),
            reply_to_id: None,
            file_path: None,
        };
        // An app without files gets a note in the body instead of the file.
        assert!(matches!(message_frame(&item, &plain), Frame::Message { file: None, body, .. } if body.contains("a.png")));
        plain.insert(FEATURE_FILES.to_string());
        assert!(matches!(message_frame(&item, &plain), Frame::Message { file: Some(_), body, .. } if body.is_empty()));
    }

    #[test]
    fn account_ids_are_checked() {
        assert!(valid_user_id("6f1c2a9e-1b2c-4d5e-8f90-123456789abc"));
        assert!(!valid_user_id("../other"));
        assert!(!valid_user_id(""));
    }
}
