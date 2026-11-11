//! How the window sits on the screen: kept on top of other windows, see-through, and letting clicks
//! pass through it to whatever is behind. Changed from Settings > Window and from the tray menu.
//!
//! See-through and click-through are window styles that Windows applies to the whole window, title
//! bar included. The window library rewrites those styles whenever it changes something of its own
//! (keeping on top, maximizing, showing after the tray), which drops ours, so they are put back
//! after such changes (see `reapply`).
//!
//! A window that ignores clicks can't be clicked to turn that off again. The tray menu can, and so
//! does anything that brings the window forward on purpose (the tray icon, the open shortcut,
//! starting Novaroom again).

use std::sync::{Mutex, MutexGuard};
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Submenu},
    AppHandle, Emitter, Manager, WebviewWindow, Wry,
};

/// The least solid the window can be made, in percent, so it can always still be seen.
const MIN_OPACITY: u8 = 30;

/// The see-through choices in the tray menu: how solid the window is in percent, and the label.
const TRAY_LEVELS: [(u8, &str); 4] = [(100, "Off"), (75, "25%"), (50, "50%"), (30, "70%")];

/// Sent to the window when the look changes from outside it (the tray menu, or click-through ending).
const CHANGED_EVENT: &str = "window-look-changed";

#[derive(Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Look {
    /// Kept above other apps' windows.
    pinned: bool,
    /// How solid the window is in percent; 100 is solid.
    opacity: u8,
    /// Never saved, so the app always starts clickable.
    click_through: bool,
}

impl Default for Look {
    fn default() -> Self {
        Self {
            pinned: false,
            opacity: 100,
            click_through: false,
        }
    }
}

#[derive(Default)]
struct Inner {
    look: Look,
    /// Whether we turned on the window's layered style, so we only ever turn off our own.
    layered: bool,
}

#[derive(Default)]
pub struct WindowLook(Mutex<Inner>);

/// The tray menu's items for these settings, kept so their ticks can follow changes made elsewhere.
pub struct TrayItems {
    pub pin: CheckMenuItem<Wry>,
    pub click_through: CheckMenuItem<Wry>,
    levels: Vec<(u8, CheckMenuItem<Wry>)>,
}

// The lock is never held while calling into the window or the menu: those calls can run window
// events on this same thread, which come back here (see `reapply`).
fn lock(state: &WindowLook) -> MutexGuard<'_, Inner> {
    state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn saved_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("window.json"))
}

fn save(app: &AppHandle, look: Look) {
    let Some(path) = saved_file(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let saved = Look {
        click_through: false,
        ..look
    };
    if let Ok(bytes) = serde_json::to_vec_pretty(&saved) {
        // Not remembered if this fails; the window starts as it was before.
        let _ = std::fs::write(path, bytes);
    }
}

#[cfg(windows)]
fn apply(window: &WebviewWindow, look: Look, layered: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE, LWA_ALPHA, WS_EX_LAYERED,
        WS_EX_TRANSPARENT,
    };
    let Ok(handle) = window.hwnd() else { return };
    let hwnd = handle.0 as windows_sys::Win32::Foundation::HWND;
    let wanted = look.opacity < 100 || look.click_through;
    // SAFETY: `hwnd` is this app's own live window, and these calls only read and set its styles.
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let mut next = current & !WS_EX_TRANSPARENT;
        if wanted {
            next |= WS_EX_LAYERED;
            if look.click_through {
                next |= WS_EX_TRANSPARENT;
            }
        } else if layered {
            next &= !WS_EX_LAYERED;
        }
        if next != current {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
        }
        if wanted {
            let alpha = (u32::from(look.opacity) * 255 / 100) as u8;
            SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA);
        }
    }
}

#[cfg(not(windows))]
fn apply(_window: &WebviewWindow, _look: Look, _layered: bool) {}

/// Puts the styles back after the window library has rewritten them. Cheap when nothing is set.
pub fn reapply(window: &WebviewWindow) {
    let state = window.state::<WindowLook>();
    let (look, layered) = {
        let inner = lock(&state);
        (inner.look, inner.layered)
    };
    let wanted = look.opacity < 100 || look.click_through;
    if !wanted && !layered {
        return;
    }
    apply(window, look, layered);
    lock(&state).layered = wanted;
}

fn sync_tray(app: &AppHandle, look: Look) {
    let Some(items) = app.try_state::<TrayItems>() else { return };
    let _ = items.pin.set_checked(look.pinned);
    let _ = items.click_through.set_checked(look.click_through);
    for (opacity, item) in &items.levels {
        let _ = item.set_checked(*opacity == look.opacity);
    }
}

/// Changes the look, applies it to the window, remembers it and updates the tray menu's ticks.
/// `tell_window` is for changes the window did not make itself, so Settings can show them.
fn change(app: &AppHandle, edit: impl FnOnce(&mut Look), tell_window: bool) -> Look {
    let state = app.state::<WindowLook>();
    let (before, look) = {
        let mut inner = lock(&state);
        let before = inner.look;
        edit(&mut inner.look);
        inner.look.opacity = inner.look.opacity.clamp(MIN_OPACITY, 100);
        // Not on top, the first click through the window would put it behind the app that was clicked.
        if inner.look.click_through && !before.click_through {
            inner.look.pinned = true;
        }
        (before, inner.look)
    };
    if let Some(window) = app.get_webview_window("main") {
        if look.pinned != before.pinned {
            let _ = window.set_always_on_top(look.pinned);
        }
        reapply(&window);
    }
    if look.pinned != before.pinned || look.opacity != before.opacity {
        save(app, look);
    }
    // Always, even when nothing changed: a clicked tray item has already flipped its own tick.
    sync_tray(app, look);
    if tell_window && look != before {
        let _ = app.emit(CHANGED_EVENT, look);
    }
    look
}

/// Applies the look saved last time. Called once at startup, before the tray menu is built.
pub fn start(app: &AppHandle) {
    let saved = saved_file(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<Look>(&bytes).ok())
        .unwrap_or_default();
    change(
        app,
        |look| {
            *look = Look {
                click_through: false,
                ..saved
            }
        },
        false,
    );
}

/// Builds the tray menu's items: "Keep on top", the "See-through" submenu and "Click-through".
/// The caller puts them in the menu and then hands `TrayItems` to `app.manage`.
pub fn tray_items(app: &AppHandle) -> tauri::Result<(TrayItems, Submenu<Wry>)> {
    let look = lock(&app.state::<WindowLook>()).look;
    let pin = CheckMenuItem::with_id(app, "pin", "Keep on top", true, look.pinned, None::<&str>)?;
    let click_through = CheckMenuItem::with_id(
        app,
        "click-through",
        "Click-through",
        true,
        look.click_through,
        None::<&str>,
    )?;
    let mut levels = Vec::new();
    for (opacity, label) in TRAY_LEVELS {
        let id = format!("see-through-{opacity}");
        let item = CheckMenuItem::with_id(app, id, label, true, look.opacity == opacity, None::<&str>)?;
        levels.push((opacity, item));
    }
    let level_items: Vec<&dyn IsMenuItem<Wry>> = levels.iter().map(|(_, item)| item as &dyn IsMenuItem<Wry>).collect();
    let see_through = Submenu::with_id_and_items(app, "see-through", "See-through", true, &level_items)?;
    Ok((
        TrayItems {
            pin,
            click_through,
            levels,
        },
        see_through,
    ))
}

/// Handles a click on one of the tray menu's items from `tray_items`. False when `id` is not one.
pub fn tray_menu_event(app: &AppHandle, id: &str) -> bool {
    match id {
        "pin" => {
            change(app, |look| look.pinned = !look.pinned, true);
        }
        "click-through" => {
            change(app, |look| look.click_through = !look.click_through, true);
        }
        _ => {
            let Some(opacity) = id.strip_prefix("see-through-").and_then(|level| level.parse::<u8>().ok()) else {
                return false;
            };
            change(app, |look| look.opacity = opacity, true);
        }
    }
    true
}

/// The look as it is now, for Settings > Window.
#[tauri::command]
pub fn window_look(state: tauri::State<WindowLook>) -> Look {
    lock(&state).look
}

/// Sets the look from Settings > Window. Returns what was applied, which can differ from what was
/// asked for: turning on click-through also keeps the window on top.
#[tauri::command]
pub fn set_window_look(app: AppHandle, look: Look) -> Look {
    change(&app, |current| *current = look, false)
}

/// Makes the window take clicks again, and tells it so its switch shows the change.
pub fn end_click_through(app: &AppHandle) {
    if !lock(&app.state::<WindowLook>()).look.click_through {
        return;
    }
    change(app, |look| look.click_through = false, true);
}
