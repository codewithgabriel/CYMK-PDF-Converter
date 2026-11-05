#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use inkwell::{
    docx::{AcceptedImage, Exported},
    studio::{GenerateRequest, GeneratedImage, OpenedDocument, Studio, StudioStatus},
};
use tauri::Manager;

#[tauri::command]
fn studio_status(studio: tauri::State<'_, Studio>) -> Result<StudioStatus, String> {
    studio.status()
}

#[tauri::command]
fn studio_set_key(studio: tauri::State<'_, Studio>, key: String) -> Result<StudioStatus, String> {
    studio.set_key(key)
}

#[tauri::command]
async fn studio_open(
    studio: tauri::State<'_, Studio>,
    path: String,
) -> Result<OpenedDocument, String> {
    let studio = studio.inner().clone();
    tauri::async_runtime::spawn_blocking(move || studio.open(path.as_ref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn studio_generate(
    studio: tauri::State<'_, Studio>,
    request: GenerateRequest,
) -> Result<GeneratedImage, String> {
    let studio = studio.inner().clone();
    tauri::async_runtime::spawn_blocking(move || studio.generate(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn studio_export(
    studio: tauri::State<'_, Studio>,
    session_id: String,
    output: String,
    accepted: Vec<AcceptedImage>,
) -> Result<Exported, String> {
    let studio = studio.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        studio.export(&session_id, output.as_ref(), &accepted)
    })
    .await
    .map_err(|e| e.to_string())?
}
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
        .manage(Studio::from_environment())
        .invoke_handler(tauri::generate_handler![
            convert_pdf,
            studio_status,
            studio_set_key,
            studio_open,
            studio_generate,
            studio_export
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Inkwell");
}
