//! Warns about Astrill VPN's Winsock component, which crashes Novaroom.
//!
//! Astrill registers a Winsock Layered Service Provider (ASProxy64.dll) that Windows loads into any
//! program the first time it opens a network connection. In Novaroom that is the update check,
//! about 15 seconds after launch, and the DLL then crashes the whole process: the window and the
//! tray icon vanish, and crash.log stays empty because it is not a Rust panic.
//!
//! Two defences, both Windows only:
//! - at launch, the Winsock catalog is read from the registry (which loads nothing) and, when the
//!   Astrill component is registered, a dialog explains how to remove it before the crash can happen.
//! - a crash handler notes which DLL a native crash happened in, writes it to crash.log, and shows
//!   the same explanation when it was that component.

#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};

/// Part of the DLL's name as it appears in the Winsock catalog, compared ignoring case.
const ASTRILL_LSP: &str = "asproxy";

/// What the person can do about it, in the same words as the Help screen (src/screens/Help.tsx).
/// Shown by the launch check and by the crash handler.
pub const FIX_TEXT: &str = "Astrill VPN (or another VPN that filters traffic) left a filter in Windows' network stack that makes Novaroom close on its own about 15 seconds after it opens.\n\nTo fix it: quit Novaroom and the VPN, open Windows Terminal as administrator, and run these three commands:\n\n    netsh winsock reset\n    netsh int ip reset\n    ipconfig /flushdns\n\nThen restart Windows and open Novaroom before the VPN. The same steps are under Settings > Help in Novaroom.";

/// Whether Astrill's component is in the Winsock catalog, so Novaroom will crash at its first
/// network use.
pub fn astrill_lsp_registered() -> bool {
    #[cfg(windows)]
    {
        catalog_dlls().iter().any(|dll| dll.to_ascii_lowercase().contains(ASTRILL_LSP))
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Shows the explanation when the component is registered. The dialog is its own window on its own
/// thread, so the app carries on behind it.
pub fn warn_if_astrill_lsp() {
    if !astrill_lsp_registered() {
        return;
    }
    log("found Astrill's Winsock component (ASProxy64.dll) in the catalog; Novaroom will crash at its first network use");
    std::thread::spawn(|| show_box("Novaroom will close on its own", FIX_TEXT));
}

/// Installs the handler for native crashes (ones inside a DLL, not Rust panics, which log_panics in
/// lib.rs covers). It writes the faulting DLL to crash.log and tells the person what happened.
pub fn install_crash_handler() {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Diagnostics::Debug::SetUnhandledExceptionFilter;
        // SAFETY: on_crash is a plain function that stays valid for the life of the process.
        unsafe { SetUnhandledExceptionFilter(Some(on_crash)) };
    }
}

#[cfg(windows)]
static HANDLING_CRASH: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
unsafe extern "system" fn on_crash(
    info: *const windows_sys::Win32::System::Diagnostics::Debug::EXCEPTION_POINTERS,
) -> i32 {
    use windows_sys::Win32::System::Diagnostics::Debug::EXCEPTION_EXECUTE_HANDLER;
    // A crash while handling a crash: give up at once.
    if HANDLING_CRASH.swap(true, Ordering::SeqCst) {
        return EXCEPTION_EXECUTE_HANDLER;
    }
    let mut code = 0u32;
    let mut module = String::new();
    // SAFETY: Windows passes a valid record, but each pointer is checked before being read.
    if let Some(info) = info.as_ref() {
        if let Some(record) = info.ExceptionRecord.as_ref() {
            code = record.ExceptionCode as u32;
            module = module_at(record.ExceptionAddress).unwrap_or_default();
        }
    }
    let shown = if module.is_empty() { "an unknown place".to_string() } else { module.clone() };
    log(&format!("crashed with error 0x{code:08X} in {shown}"));
    let file_name = module.rsplit(['\\', '/']).next().unwrap_or("").to_ascii_lowercase();
    if file_name.contains(ASTRILL_LSP) {
        show_box("Novaroom closed because of Astrill VPN", FIX_TEXT);
    } else {
        show_box(
            "Novaroom closed unexpectedly",
            &format!(
                "Novaroom crashed in {shown} (error 0x{code:08X}).\n\nDetails are in %LOCALAPPDATA%\\com.novawave.novaroom\\logs\\crash.log; please send that file to us."
            ),
        );
    }
    EXCEPTION_EXECUTE_HANDLER
}

/// The full path of the DLL or program that contains `address`.
#[cfg(windows)]
unsafe fn module_at(address: *mut core::ffi::c_void) -> Option<String> {
    use windows_sys::Win32::System::LibraryLoader::{
        GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
        GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    };
    let mut module = std::ptr::null_mut();
    let found = GetModuleHandleExW(
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        address as *const u16,
        &mut module,
    );
    if found == 0 {
        return None;
    }
    let mut path = [0u16; 1024];
    let length = GetModuleFileNameW(module, path.as_mut_ptr(), path.len() as u32) as usize;
    if length == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&path[..length.min(path.len())]))
}

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The DLL paths of every entry in the Winsock catalog. Reading the registry loads none of them.
#[cfg(windows)]
fn catalog_dlls() -> Vec<String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
    };
    const CATALOG: &str = "SYSTEM\\CurrentControlSet\\Services\\WinSock2\\Parameters\\Protocol_Catalog9";
    let mut dlls = Vec::new();
    // Catalog_Entries64 is what a 64-bit program such as Novaroom loads; Catalog_Entries is for
    // 32-bit programs, listed too in case it is ever the only place the component appears.
    for entries in ["Catalog_Entries64", "Catalog_Entries"] {
        let path = wide(&format!("{CATALOG}\\{entries}"));
        let mut key: HKEY = null_mut();
        // SAFETY: path is null-terminated; key receives the handle, closed below.
        if unsafe { RegOpenKeyExW(HKEY_LOCAL_MACHINE, path.as_ptr(), 0, KEY_READ, &mut key) } != 0 {
            continue;
        }
        for index in 0.. {
            let mut name = [0u16; 256];
            let mut length = name.len() as u32;
            // SAFETY: name has room for `length` characters; the other outputs may be null.
            let status = unsafe {
                RegEnumKeyExW(key, index, name.as_mut_ptr(), &mut length, null(), null_mut(), null_mut(), null_mut())
            };
            if status != 0 {
                break;
            }
            let mut entry: HKEY = null_mut();
            // SAFETY: RegEnumKeyExW null-terminated name; entry is closed below.
            if unsafe { RegOpenKeyExW(key, name.as_ptr(), 0, KEY_READ, &mut entry) } != 0 {
                continue;
            }
            if let Some(dll) = packed_item_dll(entry) {
                dlls.push(dll);
            }
            // SAFETY: entry was opened above.
            unsafe { RegCloseKey(entry) };
        }
        // SAFETY: key was opened above.
        unsafe { RegCloseKey(key) };
    }
    dlls
}

/// The DLL path an entry's PackedCatalogItem value starts with (a null-terminated ANSI string,
/// followed by the packed WSAPROTOCOL_INFO).
#[cfg(windows)]
fn packed_item_dll(entry: windows_sys::Win32::System::Registry::HKEY) -> Option<String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::System::Registry::RegQueryValueExW;
    let value = wide("PackedCatalogItem");
    let mut size = 0u32;
    // SAFETY: with no buffer, the call only reports the size needed.
    if unsafe { RegQueryValueExW(entry, value.as_ptr(), null(), null_mut(), null_mut(), &mut size) } != 0 {
        return None;
    }
    let mut data = vec![0u8; size as usize];
    // SAFETY: data has `size` bytes, as the first call asked for.
    if unsafe { RegQueryValueExW(entry, value.as_ptr(), null(), null_mut(), data.as_mut_ptr(), &mut size) } != 0 {
        return None;
    }
    let end = data.iter().position(|byte| *byte == 0).unwrap_or(data.len());
    Some(String::from_utf8_lossy(&data[..end]).into_owned())
}

/// A plain Windows message box that stays on top, so it is seen even when the window is hidden.
#[cfg(windows)]
fn show_box(title: &str, text: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONWARNING, MB_OK, MB_SETFOREGROUND, MB_TOPMOST,
    };
    let title = wide(title);
    let text = wide(text);
    // SAFETY: both strings are null-terminated and outlive the call.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONWARNING | MB_SETFOREGROUND | MB_TOPMOST,
        )
    };
}

#[cfg(not(windows))]
fn show_box(_title: &str, _text: &str) {}

/// Appends to crash.log, next to what log_panics in lib.rs writes, so there is one file to send.
fn log(message: &str) {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else { return };
    use std::io::Write;
    let dir = std::path::Path::new(&local).join("com.novawave.novaroom").join("logs");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("crash.log")) {
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "[unix {seconds}] Novaroom {} {message}", env!("CARGO_PKG_VERSION"));
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// Every Windows has Microsoft's own TCP/IP provider in the catalog, so reading it must find
    /// that DLL; the parsing of PackedCatalogItem is what this checks.
    #[test]
    fn catalog_lists_the_windows_provider() {
        let dlls = catalog_dlls();
        assert!(
            dlls.iter().any(|dll| dll.to_ascii_lowercase().contains("mswsock.dll")),
            "catalog entries: {dlls:?}"
        );
    }
}
