//! Capture: recordings of the screen, the microphone and what the speakers play, kept on this
//! computer in Videos\Novaroom. Nothing is uploaded.
//!
//! The window records the screen (through WebView2's own picker) and the microphone itself, but it
//! cannot hear the speakers. This side listens to them with WASAPI loopback and streams the samples
//! to the window, which mixes them with the microphone. The window sends the recording here about
//! once a second while it records, and each piece is added to the file straight away, so a long
//! recording never has to fit in memory and most of it survives if the app closes mid-way.

use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Kinds of file the window can record into. Anything else in the folder is not listed.
const EXTENSIONS: &[&str] = &["mp4", "webm", "m4a"];
const MAX_NAME: usize = 120;
/// Speaker samples are sent to the window in pieces this long, so it gets them in good time
/// without a message for every few milliseconds of sound.
const SPEAKER_PIECE: Duration = Duration::from_millis(40);

#[derive(Default)]
pub struct Capture {
    /// Recordings being written, by file name.
    writing: Mutex<HashMap<String, File>>,
    /// Stops the speaker loopback, while it runs.
    speaker: Mutex<Option<mpsc::Sender<Speaker>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    name: String,
    size: u64,
    /// Milliseconds since 1970, when the file was last written.
    modified: u64,
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .video_dir()
        .map_err(|_| "Could not find your Videos folder.".to_string())?
        .join("Novaroom");
    std::fs::create_dir_all(&dir).map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    Ok(dir)
}

/// A recording's file in the folder. Names come from the window, so anything that could reach
/// another folder is refused.
fn recording_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let ok = !name.is_empty()
        && name.len() <= MAX_NAME + 8
        && !name.contains(['/', '\\', ':'])
        && !name.starts_with('.')
        && Path::new(name)
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| EXTENSIONS.contains(&ext));
    if !ok {
        return Err("That is not a Novaroom recording.".into());
    }
    Ok(folder(app)?.join(name))
}

fn describe(path: &Path) -> Option<Recording> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |elapsed| elapsed.as_millis() as u64);
    Some(Recording {
        name: path.file_name()?.to_string_lossy().into_owned(),
        size: meta.len(),
        modified,
    })
}

/// Where recordings are saved, to show the person.
#[tauri::command]
pub fn capture_folder(app: AppHandle) -> Result<String, String> {
    Ok(folder(&app)?.display().to_string())
}

/// Every recording in the folder, newest first.
#[tauri::command]
pub fn capture_list(app: AppHandle, state: State<Capture>) -> Result<Vec<Recording>, String> {
    let dir = folder(&app)?;
    let writing = state.writing.lock().unwrap();
    let mut list: Vec<Recording> = std::fs::read_dir(&dir)
        .map_err(|error| error.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        })
        .filter_map(|path| describe(&path))
        // The one being recorded shows once it is finished.
        .filter(|recording| !writing.contains_key(&recording.name))
        .collect();
    list.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(list)
}

/// Creates the file for a new recording and returns its name. `name` is the window's suggestion
/// (the local date and time); a number is added if that file already exists.
#[tauri::command]
pub fn capture_begin(app: AppHandle, state: State<Capture>, name: String, ext: String) -> Result<String, String> {
    if !EXTENSIONS.contains(&ext.as_str()) {
        return Err("Novaroom cannot save that kind of recording.".into());
    }
    let base: String = name
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .take(MAX_NAME)
        .collect();
    let base = base.trim().trim_matches('.');
    let base = if base.is_empty() { "Recording" } else { base };
    let dir = folder(&app)?;
    for attempt in 1..1000 {
        let file_name = if attempt == 1 {
            format!("{base}.{ext}")
        } else {
            format!("{base} ({attempt}).{ext}")
        };
        match File::options().write(true).create_new(true).open(dir.join(&file_name)) {
            Ok(file) => {
                state.writing.lock().unwrap().insert(file_name.clone(), file);
                return Ok(file_name);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create the recording: {error}")),
        }
    }
    Err("Could not find a free name for the recording.".into())
}

/// Adds the next piece of a recording. The bytes are the request body; header `x-name` says which
/// recording.
#[tauri::command]
pub fn capture_write(request: Request<'_>, state: State<Capture>) -> Result<(), String> {
    let name = request
        .headers()
        .get("x-name")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing recording name.")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the recording's bytes.".into());
    };
    let mut writing = state.writing.lock().unwrap();
    let file = writing.get_mut(name).ok_or("That recording is not open.")?;
    file.write_all(bytes)
        .map_err(|error| format!("Could not save the recording: {error}. Is the disk full?"))
}

/// Closes a recording once its last piece is written.
#[tauri::command]
pub fn capture_finish(app: AppHandle, state: State<Capture>, name: String) -> Result<Recording, String> {
    let file = state.writing.lock().unwrap().remove(&name).ok_or("That recording is not open.")?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    describe(&recording_path(&app, &name)?).ok_or("The recording was saved, but could not be read back.".into())
}

#[tauri::command]
pub fn capture_open(app: AppHandle, name: String) -> Result<(), String> {
    let path = recording_path(&app, &name)?;
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

/// Opens the folder in File Explorer, with the recording selected when there is one.
#[tauri::command]
pub fn capture_reveal(app: AppHandle, name: Option<String>) -> Result<(), String> {
    match name {
        Some(name) => app
            .opener()
            .reveal_item_in_dir(recording_path(&app, &name)?)
            .map_err(|error| error.to_string()),
        None => app
            .opener()
            .open_path(folder(&app)?.display().to_string(), None::<&str>)
            .map_err(|error| error.to_string()),
    }
}

#[tauri::command]
pub fn capture_delete(app: AppHandle, state: State<Capture>, name: String) -> Result<(), String> {
    if state.writing.lock().unwrap().contains_key(&name) {
        return Err("That recording is still being made.".into());
    }
    std::fs::remove_file(recording_path(&app, &name)?).map_err(|error| format!("Could not delete it: {error}"))
}

enum Speaker {
    Samples(Vec<f32>),
    Stop,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerFormat {
    sample_rate: u32,
}

/// Starts listening to what the default speakers play. The samples go to `channel` as stereo
/// 32-bit floats, interleaved, little-endian, in pieces of about 40 ms. Silence sends nothing:
/// Windows only hands over sound while something plays.
#[tauri::command]
pub fn capture_speaker_start(
    state: State<Capture>,
    channel: Channel<InvokeResponseBody>,
) -> Result<SpeakerFormat, String> {
    let mut running = state.speaker.lock().unwrap();
    if let Some(previous) = running.take() {
        let _ = previous.send(Speaker::Stop);
    }
    let (sender, receiver) = mpsc::channel::<Speaker>();
    let (ready, started) = mpsc::channel::<Result<u32, String>>();
    let to_stream = sender.clone();
    // The stream has to stay on the thread that made it, so that thread also does the sending.
    std::thread::Builder::new()
        .name("capture-speaker".into())
        .spawn(move || {
            let stream = match open_loopback(to_stream) {
                Ok((stream, rate)) => {
                    let _ = ready.send(Ok(rate));
                    stream
                }
                Err(error) => {
                    let _ = ready.send(Err(error));
                    return;
                }
            };
            let mut piece = Vec::new();
            loop {
                match receiver.recv_timeout(SPEAKER_PIECE) {
                    Ok(Speaker::Samples(samples)) => {
                        piece.extend_from_slice(&samples);
                        // Roughly SPEAKER_PIECE of 48 kHz stereo.
                        if piece.len() < 48 * 2 * SPEAKER_PIECE.as_millis() as usize {
                            continue;
                        }
                    }
                    Ok(Speaker::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if piece.is_empty() {
                    continue;
                }
                let bytes: Vec<u8> = piece.drain(..).flat_map(f32::to_le_bytes).collect();
                if channel.send(InvokeResponseBody::Raw(bytes)).is_err() {
                    // The window went away.
                    break;
                }
            }
            drop(stream);
        })
        .map_err(|error| error.to_string())?;
    let rate = started
        .recv()
        .map_err(|_| "Could not start listening to the speakers.".to_string())??;
    *running = Some(sender);
    Ok(SpeakerFormat { sample_rate: rate })
}

#[tauri::command]
pub fn capture_speaker_stop(state: State<Capture>) {
    if let Some(running) = state.speaker.lock().unwrap().take() {
        let _ = running.send(Speaker::Stop);
    }
}

/// An input stream on the default output device, which WASAPI treats as loopback: it hears
/// whatever that device plays.
fn open_loopback(sender: mpsc::Sender<Speaker>) -> Result<(cpal::Stream, u32), String> {
    let device = cpal::default_host()
        .default_output_device()
        .ok_or("No speakers or headphones were found.")?;
    let supported = device.default_output_config().map_err(|error| error.to_string())?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let channels = usize::from(config.channels);
    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, &config, channels, sender),
        cpal::SampleFormat::I16 => build::<i16>(&device, &config, channels, sender),
        cpal::SampleFormat::I32 => build::<i32>(&device, &config, channels, sender),
        cpal::SampleFormat::U16 => build::<u16>(&device, &config, channels, sender),
        other => return Err(format!("The speakers use a sound format Novaroom cannot read ({other}).")),
    }
    .map_err(|error| format!("Could not listen to the speakers: {error}"))?;
    stream.play().map_err(|error| format!("Could not listen to the speakers: {error}"))?;
    Ok((stream, config.sample_rate.0))
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    sender: mpsc::Sender<Speaker>,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    device.build_input_stream(
        config,
        move |data: &[T], _| {
            let mut stereo = Vec::with_capacity(data.len() / channels.max(1) * 2);
            for frame in data.chunks_exact(channels.max(1)) {
                let (left, right) = to_stereo(frame.iter().map(|sample| sample.to_sample::<f32>()));
                stereo.push(left);
                stereo.push(right);
            }
            let _ = sender.send(Speaker::Samples(stereo));
        },
        // A changed or unplugged device ends the stream; the recording carries on without it.
        |_error| {},
        None,
    )
}

/// One frame of any layout as left and right. Surround layouts (front left, front right, centre,
/// LFE, back or side left, back or side right) fold the centre and rear into both sides, so
/// dialogue on the centre channel is kept.
fn to_stereo(mut frame: impl Iterator<Item = f32>) -> (f32, f32) {
    let samples: Vec<f32> = frame.by_ref().take(8).collect();
    match samples.as_slice() {
        [mono] => (*mono, *mono),
        [left, right] => (*left, *right),
        [left, right, centre, rest @ ..] => {
            let (rear_left, rear_right) = match rest {
                [_lfe, rear_left, rear_right, ..] => (*rear_left, *rear_right),
                _ => (0.0, 0.0),
            };
            let fold = std::f32::consts::FRAC_1_SQRT_2;
            let scale = 1.0 / (1.0 + 2.0 * fold);
            (
                (left + fold * centre + fold * rear_left) * scale,
                (right + fold * centre + fold * rear_right) * scale,
            )
        }
        [] => (0.0, 0.0),
    }
}
