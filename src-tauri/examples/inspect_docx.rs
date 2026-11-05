//! Local-only QA for a real sample. Never contacts OpenAI.
use inkwell::{docx::DocxPackage, studio::Studio};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
    path::PathBuf,
};
fn parts(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut p = zip.by_index(i).unwrap();
            let name = p.name().to_owned();
            let mut bytes = vec![];
            p.read_to_end(&mut bytes).unwrap();
            (name, bytes)
        })
        .collect()
}
fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    let source = PathBuf::from(
        args.get(1)
            .ok_or("Usage: inspect_docx SOURCE OUTPUT_DIRECTORY")?,
    );
    let out = PathBuf::from(args.get(2).ok_or("Missing output directory")?);
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let studio = Studio::default();
    let opened = studio.open(&source)?;
    println!(
        "Detected {} image placements; {} supported; {} warnings.",
        opened.images.len(),
        opened.images.iter().filter(|p| p.supported).count(),
        opened.warnings.len()
    );
    for warning in &opened.warnings {
        println!("{warning}");
    }
    std::fs::write(
        out.join("preview.json"),
        serde_json::to_vec(&opened).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    let package = DocxPackage::open(&source)?;
    let output = out.join("roundtrip.docx");
    package.export(&output, &BTreeMap::new())?;
    assert_eq!(
        parts(&std::fs::read(&source).unwrap()),
        parts(&std::fs::read(&output).unwrap())
    );
    println!(
        "Every original document part preserved in an unmodified export. No API requests made."
    );
    Ok(())
}
