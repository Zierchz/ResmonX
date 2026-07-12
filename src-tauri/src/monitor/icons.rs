use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

// path del exe -> data URI PNG (None si no tiene icono accesible)
fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static C: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18 & 63) as usize] as char);
        out.push(B64[(n >> 12 & 63) as usize] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6 & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// Convierte un HICON a PNG data URI vía GDI. Libera los bitmaps que crea.
unsafe fn hicon_to_png(hicon: HICON) -> Option<String> {
    let mut ii = ICONINFO::default();
    GetIconInfo(hicon, &mut ii).ok()?;
    let color = ii.hbmColor;
    let mask = ii.hbmMask;

    let result = (|| {
        let mut bmp = BITMAP::default();
        let got = GetObjectW(
            color.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut core::ffi::c_void),
        );
        if got == 0 || bmp.bmWidth <= 0 || bmp.bmHeight <= 0 {
            return None;
        }
        let (w, h) = (bmp.bmWidth, bmp.bmHeight);

        let mut bi = BITMAPINFO::default();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = w;
        bi.bmiHeader.biHeight = -h; // negativo = top-down
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB.0;

        let mut buf = vec![0u8; (w * h * 4) as usize];
        let hdc = GetDC(None);
        let lines = GetDIBits(
            hdc,
            color,
            0,
            h as u32,
            Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
            &mut bi,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, hdc);
        if lines == 0 {
            return None;
        }

        // GDI entrega BGRA; algunos iconos no traen canal alpha (todo 0)
        let has_alpha = buf.chunks_exact(4).any(|px| px[3] != 0);
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2); // BGRA -> RGBA
            if !has_alpha {
                px[3] = 255;
            }
        }

        let img = image::RgbaImage::from_raw(w as u32, h as u32, buf)?;
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).ok()?;
        Some(format!("data:image/png;base64,{}", base64(&out.into_inner())))
    })();

    if !color.0.is_null() {
        let _ = DeleteObject(color.into());
    }
    if !mask.0.is_null() {
        let _ = DeleteObject(mask.into());
    }
    result
}

fn extract(path: &str) -> Option<String> {
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut shfi = SHFILEINFOW::default();
        let r = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut shfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if r == 0 {
            return None;
        }
        let png = hicon_to_png(shfi.hIcon);
        let _ = DestroyIcon(shfi.hIcon);
        png
    }
}

/// Devuelve el icono del ejecutable como PNG data URI, cacheado por ruta.
#[tauri::command]
pub fn get_icon(path: String) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    if let Some(v) = cache().lock().ok().and_then(|c| c.get(&path).cloned()) {
        return v;
    }
    let icon = extract(&path);
    if let Ok(mut c) = cache().lock() {
        c.insert(path, icon.clone());
    }
    icon
}
