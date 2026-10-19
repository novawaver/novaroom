use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;

mod vault;

/// The argument Windows passes when it starts Novaroom at sign-in, so we can tell that launch apart.
const AUTOSTART_ARG: &str = "--autostart";
/// Name of the value under HKCU\Software\Microsoft\Windows\CurrentVersion\Run. The uninstaller
/// hook in windows/hooks.nsh deletes the same value, so keep the two in step.
const AUTOSTART_NAME: &str = "Novaroom";

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Whether the window has changes the person has not saved yet (an edited Vault). While it does,
/// Quit in the tray asks the window first instead of closing straight away.
#[derive(Default)]
struct UnsavedChanges(std::sync::atomic::AtomicBool);

#[tauri::command]
fn set_unsaved_changes(state: tauri::State<UnsavedChanges>, unsaved: bool) {
    state.0.store(unsaved, std::sync::atomic::Ordering::Relaxed);
}

/// Quits for real, once the window has dealt with unsaved changes.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn request_quit(app: &tauri::AppHandle) {
    let unsaved = app
        .state::<UnsavedChanges>()
        .0
        .load(std::sync::atomic::Ordering::Relaxed);
    if unsaved {
        show_main(app);
        let _ = app.emit("quit-requested", ());
    } else {
        app.exit(0);
    }
}

/// Seconds since the last keyboard or mouse input anywhere on the computer, for the Timer.
/// Returns None where the system cannot tell us, and the app falls back to its own window.
#[tauri::command]
fn idle_seconds() -> Option<u64> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::GetTickCount;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        // SAFETY: info is a correctly sized LASTINPUTINFO that lives for the whole call.
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return None;
        }
        // Both values are milliseconds since boot; wrapping_sub copes with the 49-day rollover.
        let idle_ms = unsafe { GetTickCount() }.wrapping_sub(info.dwTime);
        Some(u64::from(idle_ms) / 1000)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// How Novaroom starts with Windows. Both are on until the person turns them off in Settings.
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StartupSettings {
    launch_at_login: bool,
    start_minimized: bool,
}

impl Default for StartupSettings {
    fn default() -> Self {
        Self {
            launch_at_login: true,
            start_minimized: true,
        }
    }
}

fn startup_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("startup.json"))
}

fn read_startup(app: &tauri::AppHandle) -> StartupSettings {
    startup_file(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_startup(app: &tauri::AppHandle, settings: StartupSettings) -> Result<(), String> {
    let path = startup_file(app).ok_or("Could not find the settings folder.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

/// Makes the Windows sign-in entry match the saved choice.
fn apply_launch_at_login(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    let result = if enabled { autolaunch.enable() } else { autolaunch.disable() };
    result.map_err(|error| error.to_string())
}

#[tauri::command]
fn startup_settings(app: tauri::AppHandle) -> StartupSettings {
    read_startup(&app)
}

#[tauri::command]
fn set_startup_settings(app: tauri::AppHandle, settings: StartupSettings) -> Result<(), String> {
    apply_launch_at_login(&app, settings.launch_at_login)?;
    write_startup(&app, settings)
}

/// Release builds abort on a panic, so the app just vanishes. Before that happens, write what went
/// wrong to %LOCALAPPDATA%\com.novawave.novaroom\logs\crash.log so a tester can send it to us.
fn log_panics() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            use std::io::Write;
            let dir = std::path::Path::new(&local).join("com.novawave.novaroom").join("logs");
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("crash.log"))
            {
                let seconds = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_secs())
                    .unwrap_or(0);
                let thread = std::thread::current();
                let _ = writeln!(
                    file,
                    "[unix {seconds}] Novaroom {} panicked on thread {}: {info}",
                    env!("CARGO_PKG_VERSION"),
                    thread.name().unwrap_or("unnamed"),
                );
            }
        }
        default_hook(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log_panics();
    tauri::Builder::default()
        // Must be registered first. Clicking a Windows notification (or the Start menu shortcut)
        // launches Novaroom.exe again; that second launch exits and brings this window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(UnsavedChanges::default())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name(AUTOSTART_NAME)
                .arg(AUTOSTART_ARG)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            idle_seconds,
            startup_settings,
            set_startup_settings,
            set_unsaved_changes,
            quit_app,
            vault::vault_create,
            vault::vault_pick,
            vault::vault_read,
            vault::vault_write
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let startup = read_startup(app.handle());
            // Re-apply the saved choice on every launch, so the sign-in entry is created on first run
            // and keeps pointing at the current install. Debug builds leave it alone, so running
            // `tauri dev` never registers the development build to start with Windows.
            if !cfg!(debug_assertions) {
                let _ = apply_launch_at_login(app.handle(), startup.launch_at_login);
            }
            let launched_at_login = std::env::args().any(|arg| arg == AUTOSTART_ARG);
            if launched_at_login && startup.start_minimized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.minimize();
                }
            }

            let show = MenuItem::with_id(app, "show", "Show Novaroom", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("novaroom")
                .tooltip("Novaroom")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => request_quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
