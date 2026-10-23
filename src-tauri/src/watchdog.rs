//! Restarts Novaroom when it stops responding.
//!
//! Two things can freeze on their own, so both are watched from a thread of the watchdog's own:
//! - the main (window) thread: every few seconds it is asked to run a small job, which also notes
//!   whether the window is showing. If no job has run for a while, it is stuck.
//! - the page in the window: it sends a heartbeat (`watchdog_beat`) every few seconds. If none has
//!   come for a while *while the window is showing*, it is stuck. A hidden or minimized page is not
//!   judged, since Windows deliberately slows its timers down.
//!
//! A restart starts a new Novaroom that first waits for this one to end (otherwise the single
//! instance check would close it straight away), then ends this one. Each restart is written to
//! %LOCALAPPDATA%\com.novawave.novaroom\logs\watchdog.log.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Manager;

/// Passed to the new Novaroom with this one's process id, so it waits for this one to end.
pub const RESTART_AFTER_ARG: &str = "--restart-after=";
/// Passed to the new Novaroom when the window was hidden (in the tray), so it starts hidden too.
pub const RESTART_HIDDEN_ARG: &str = "--restart-hidden";

const CHECK_EVERY: Duration = Duration::from_secs(5);
/// How long without an answer counts as stuck.
const STUCK_AFTER: Duration = Duration::from_secs(45);
/// Nothing is judged this soon after launch, or after the computer wakes, while things settle.
const GRACE: Duration = Duration::from_secs(60);

/// Shared between the watchdog thread, the main thread and the page's heartbeat.
pub struct Watchdog {
    started: Instant,
    /// Milliseconds since `started` when the main thread last ran a job, and the page last beat.
    main_seen: AtomicU64,
    page_seen: AtomicU64,
    /// Whether the window was showing (visible and not minimized) when the main thread last looked.
    window_showing: AtomicBool,
}

impl Watchdog {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            started: Instant::now(),
            main_seen: AtomicU64::new(0),
            page_seen: AtomicU64::new(0),
            window_showing: AtomicBool::new(false),
        })
    }

    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    fn since(&self, seen: &AtomicU64) -> Duration {
        Duration::from_millis(self.now_ms().saturating_sub(seen.load(Ordering::Relaxed)))
    }

    /// Treats both as just seen, for a fresh start after launch or waking.
    fn reset(&self) {
        let now = self.now_ms();
        self.main_seen.store(now, Ordering::Relaxed);
        self.page_seen.store(now, Ordering::Relaxed);
    }
}

/// The page's heartbeat.
#[tauri::command]
pub fn watchdog_beat(state: tauri::State<'_, Arc<Watchdog>>) {
    state.page_seen.store(state.now_ms(), Ordering::Relaxed);
}

/// Starts watching. Does nothing in debug builds, where pausing in a debugger would look stuck.
pub fn start(app: &tauri::AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let watchdog = app.state::<Arc<Watchdog>>().inner().clone();
    watchdog.reset();
    let app = app.clone();
    let _ = std::thread::Builder::new().name("watchdog".into()).spawn(move || {
        let mut armed_at = Instant::now() + GRACE;
        let mut last_tick = Instant::now();
        loop {
            std::thread::sleep(CHECK_EVERY);

            // A long gap between ticks means the computer was asleep: start over.
            if last_tick.elapsed() > CHECK_EVERY * 3 {
                watchdog.reset();
                armed_at = Instant::now() + GRACE;
            }
            last_tick = Instant::now();

            // Ask the main thread to show it's alive. If it's stuck, these just queue up.
            let seen = watchdog.clone();
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let showing = handle.get_webview_window("main").is_some_and(|window| {
                    window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
                });
                // Coming back into view, the page gets a fresh start: it was not judged while hidden.
                if showing && !seen.window_showing.load(Ordering::Relaxed) {
                    seen.page_seen.store(seen.now_ms(), Ordering::Relaxed);
                }
                seen.window_showing.store(showing, Ordering::Relaxed);
                seen.main_seen.store(seen.now_ms(), Ordering::Relaxed);
            });

            if Instant::now() < armed_at {
                continue;
            }
            let showing = watchdog.window_showing.load(Ordering::Relaxed);
            if watchdog.since(&watchdog.main_seen) > STUCK_AFTER {
                restart("the window stopped responding", showing);
            }
            if showing && watchdog.since(&watchdog.page_seen) > STUCK_AFTER {
                restart("the page stopped responding", showing);
            }
        }
    });
}

/// Starts a new Novaroom and ends this one at once. Ending it from here, rather than through Tauri,
/// avoids waiting on the stuck thread.
fn restart(reason: &str, showing: bool) {
    log(reason);
    let Ok(exe) = std::env::current_exe() else { return };
    let mut command = std::process::Command::new(exe);
    command.arg(format!("{RESTART_AFTER_ARG}{}", std::process::id()));
    if !showing {
        command.arg(RESTART_HIDDEN_ARG);
    }
    if command.spawn().is_err() {
        log("could not start a new Novaroom; leaving this one running");
        return;
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};
        // SAFETY: ends this process; nothing runs after it.
        unsafe { TerminateProcess(GetCurrentProcess(), 3) };
    }
    std::process::exit(3);
}

/// In a Novaroom started by `restart`, waits (up to 15 seconds) for the stuck one to end, so the
/// single instance check doesn't mistake it for a Novaroom that's already running.
pub fn wait_for_previous() {
    let Some(pid) = std::env::args()
        .find_map(|arg| arg.strip_prefix(RESTART_AFTER_ARG).and_then(|pid| pid.parse::<u32>().ok()))
    else {
        return;
    };
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
        // SAFETY: the handle is checked before use and closed after.
        unsafe {
            let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
            if !process.is_null() {
                WaitForSingleObject(process, 15_000);
                CloseHandle(process);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        std::thread::sleep(Duration::from_secs(2));
    }
}

fn log(reason: &str) {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else { return };
    use std::io::Write;
    let dir = std::path::Path::new(&local).join("com.novawave.novaroom").join("logs");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("watchdog.log"))
    {
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or(0);
        let _ = writeln!(
            file,
            "[unix {seconds}] Novaroom {} restarted itself: {reason}",
            env!("CARGO_PKG_VERSION")
        );
    }
}
