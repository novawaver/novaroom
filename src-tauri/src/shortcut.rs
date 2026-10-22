//! The keyboard shortcut that opens the window from anywhere: Ctrl+Alt+S unless the person changes
//! it in Settings. The choice is kept in shortcut.json in the settings folder, next to startup.json.
//! Shortcuts are written the way the global-shortcut plugin reads them, e.g. "Ctrl+Alt+S" or
//! "Ctrl+Shift+Super+F5"; an empty one means the person turned it off.

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut};

const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+S";

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    shortcut: String,
}

impl Default for Saved {
    fn default() -> Self {
        Self {
            shortcut: DEFAULT_SHORTCUT.into(),
        }
    }
}

/// The saved shortcut, and whether it is actually listening (another app may have taken it first).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    shortcut: String,
    active: bool,
}

fn shortcut_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("shortcut.json"))
}

fn read_saved(app: &AppHandle) -> String {
    shortcut_file(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<Saved>(&bytes).ok())
        .unwrap_or_default()
        .shortcut
}

fn write_saved(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let path = shortcut_file(app).ok_or("Could not find the settings folder.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    let saved = Saved {
        shortcut: shortcut.into(),
    };
    let bytes = serde_json::to_vec_pretty(&saved).map_err(|error| error.to_string())?;
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

fn parse(text: &str) -> Result<Shortcut, String> {
    text.parse::<Shortcut>()
        .map_err(|_| format!("Novaroom can't use {text} as a shortcut."))
}

/// Starts listening for the saved shortcut. If another app already uses it, Settings says so.
pub fn register_saved(app: &AppHandle) {
    if let Ok(shortcut) = parse(&read_saved(app)) {
        let _ = app.global_shortcut().register(shortcut);
    }
}

#[tauri::command]
pub fn open_shortcut(app: AppHandle) -> ShortcutStatus {
    let shortcut = read_saved(&app);
    let active = parse(&shortcut)
        .map(|parsed| app.global_shortcut().is_registered(parsed))
        .unwrap_or(false);
    ShortcutStatus { shortcut, active }
}

/// Swaps the shortcut for a new one, or turns it off when `shortcut` is empty. Nothing changes if
/// the new one can't be used.
#[tauri::command]
pub fn set_open_shortcut(app: AppHandle, shortcut: String) -> Result<ShortcutStatus, String> {
    let shortcut = shortcut.trim().to_string();
    let next = if shortcut.is_empty() { None } else { Some(parse(&shortcut)?) };
    // Shift alone would take over ordinary typing, like capital letters, in every other app.
    if let Some(parsed) = next {
        if !parsed
            .mods
            .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
        {
            return Err("Include Ctrl, Alt or the Windows key in the shortcut.".into());
        }
    }
    let global = app.global_shortcut();
    let _ = global.unregister_all();
    if let Some(parsed) = next {
        if global.register(parsed).is_err() {
            register_saved(&app);
            return Err(format!("Another app is already using {shortcut}. Try a different one."));
        }
    }
    write_saved(&app, &shortcut)?;
    Ok(ShortcutStatus {
        active: next.is_some(),
        shortcut,
    })
}
