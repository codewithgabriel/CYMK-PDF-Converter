//! Generate synthetic QA fixtures. Add --live for ONE billable image edit.
#[path = "../tests/support/mod.rs"]
mod support;
use inkwell::studio::{GenerateRequest, Studio};
use std::path::PathBuf;

fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    let dir = PathBuf::from(
        args.get(1)
            .ok_or("Usage: studio_check OUTPUT_DIRECTORY [--live]")?,
    );
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let source = dir.join("A room to breathe.docx");
    std::fs::write(&source, support::document()).map_err(|e| e.to_string())?;
    let service = Studio::from_environment();
    let opened = service.open(&source)?;
    std::fs::write(
        dir.join("fixture.json"),
        serde_json::to_vec(&opened).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(dir.join("reference.png"), support::picture(false))
        .map_err(|e| e.to_string())?;
    std::fs::write(dir.join("alternate.png"), support::picture(true)).map_err(|e| e.to_string())?;
    if args.iter().any(|s| s == "--live") {
        println!("Making one image edit using the synthetic mockup and nearby text, with no user prompt.");
        let result = service.generate(GenerateRequest {
            session_id: opened.session_id.clone(),
            image_id: "image-1".into(),
            prompt: String::new(),
            use_context: true,
            style: "realistic".into(),
            quality: "high".into(),
            resolution: "standard".into(),
        })?;
        std::fs::write(
            dir.join("generated.json"),
            serde_json::to_vec(&result).unwrap(),
        )
        .map_err(|e| e.to_string())?;
        let saved = service.export(
            &opened.session_id,
            &dir.join("A room to breathe - enhanced.docx"),
            &[inkwell::docx::AcceptedImage {
                image_id: "image-1".into(),
                candidate_id: result.id,
            }],
        )?;
        println!(
            "Generated {} × {} px; exported {} replacement to {}.",
            result.width, result.height, saved.replacements, saved.path
        );
    } else {
        println!("Synthetic fixture created. No OpenAI request was made.");
    }
    Ok(())
}
