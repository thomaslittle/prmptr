// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // ONNX Runtime (via sherpa-onnx) can trigger CRT debug assertions on Windows.
    // Ensure Windows + CRT std handles are valid before any DLL loads.
    #[cfg(windows)]
    harden_windows_stdio_for_gui_process();

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();
    prmptr_lib::run()
}

/// Ensure stdin/stdout/stderr are valid in both Win32 and C runtime layers.
/// GUI subsystems can start without a console, leaving invalid std handles/fds.
#[cfg(windows)]
fn harden_windows_stdio_for_gui_process() {
    extern "system" {
        fn GetStdHandle(nStdHandle: u32) -> isize;
        fn SetStdHandle(nStdHandle: u32, hHandle: isize) -> i32;
        fn CreateFileA(
            name: *const u8, access: u32, share: u32, security: *const (),
            disposition: u32, flags: u32, template: isize,
        ) -> isize;
        fn LoadLibraryA(name: *const u8) -> isize;
        fn GetProcAddress(module: isize, name: *const u8) -> *const ();
    }

    const INVALID_HANDLE: isize = -1;

    unsafe {
        // STD_INPUT_HANDLE=-10, STD_OUTPUT_HANDLE=-11, STD_ERROR_HANDLE=-12
        for (id, access) in [
            ((-10i32) as u32, 0x80000000u32), // GENERIC_READ
            ((-11i32) as u32, 0x40000000u32), // GENERIC_WRITE
            ((-12i32) as u32, 0x40000000u32), // GENERIC_WRITE
        ] {
            let h = GetStdHandle(id);
            if h == 0 || h == INVALID_HANDLE {
                let nul = CreateFileA(
                    b"NUL\0".as_ptr(),
                    access,
                    1 | 2, // FILE_SHARE_READ | FILE_SHARE_WRITE
                    std::ptr::null(),
                    3, // OPEN_EXISTING
                    0, 0,
                );
                if nul != INVALID_HANDLE {
                    SetStdHandle(id, nul);
                }
            }
        }

        // Ensure CRT file descriptors (0/1/2) map to valid OS handles.
        // This prevents UCRT debug asserts in lowio/read.cpp.
        let null_path = b"NUL\0".as_ptr() as *const i8;
        for (fd, flags) in [
            (0, libc::O_RDONLY),
            (1, libc::O_WRONLY),
            (2, libc::O_WRONLY),
        ] {
            let osfh = libc::get_osfhandle(fd);
            // Windows CRT may return -1 or -2 for invalid/unbound handles.
            if osfh < 0 {
                let new_fd = libc::open(null_path, flags);
                if new_fd >= 0 {
                    let _ = libc::dup2(new_fd, fd);
                    let _ = libc::close(new_fd);
                }
            }
        }

        // Disable CRT assertion dialogs as a last-resort fallback.
        type SetModeFn = unsafe extern "C" fn(i32, i32) -> i32;
        for dll in [
            b"ucrtbased.dll\0" as &[u8],
            b"msvcr120d.dll\0",
            b"msvcr140d.dll\0",
            b"ucrtbase.dll\0",
        ] {
            let module = LoadLibraryA(dll.as_ptr());
            if module == 0 {
                continue;
            }
            let proc = GetProcAddress(module, b"_CrtSetReportMode\0".as_ptr());
            if proc.is_null() {
                continue;
            }
            let set_mode: SetModeFn = std::mem::transmute(proc);
            set_mode(0, 2); // _CRT_WARN -> OutputDebugString
            set_mode(1, 2); // _CRT_ERROR -> OutputDebugString
            set_mode(2, 2); // _CRT_ASSERT -> OutputDebugString
        }
    }
}
