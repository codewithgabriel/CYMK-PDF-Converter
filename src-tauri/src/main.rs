#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::Manager;
#[tauri::command]
async fn convert_pdf(
    app: tauri::AppHandle,
    input: String,
    output: String,
    density: u8,
    dpi: u32,
) -> Result<inkwell::Conversion, String> {
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let bundled = resources.join("ghostscript/bin/gswin64c.exe");
    let engine = if bundled.exists() {
        bundled
    } else if cfg!(debug_assertions) || !cfg!(windows) {
        std::env::var("INKWELL_GS")
            .unwrap_or(if cfg!(windows) { "gswin64c" } else { "gs" }.into())
            .into()
    } else {
        return Err("Bundled PDF engine is missing. Please reinstall Inkwell.".into());
    };
    tauri::async_runtime::spawn_blocking(move || {
        inkwell::convert(input.as_ref(), output.as_ref(), density, dpi, &engine)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![convert_pdf])
        .run(tauri::generate_context!())
        .expect("Could not start Inkwell");
}
