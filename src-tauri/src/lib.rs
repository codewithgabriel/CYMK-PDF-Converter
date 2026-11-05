use lopdf::Document;
pub mod docx;
pub mod studio;
use serde::Serialize;
use std::{fs::File, io::Read, path::Path, process::Command};

#[derive(Debug, Serialize)]
pub struct Conversion {
    pub pages: usize,
    pub bytes: u64,
    pub path: String,
}

fn run_pdfwrite(gs: &Path, input: &Path, output: &Path, density: Option<u8>) -> Result<(), String> {
    let mut command = Command::new(gs);
    command.args([
        "-q",
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        "-dPDFSTOPONERROR",
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.7",
        "-sColorConversionStrategy=CMYK",
        "-dAutoRotatePages=/None",
        "-dPreserveSeparation=false",
        "-dPreserveDeviceN=false",
        "-dDownsampleColorImages=false",
        "-dDownsampleGrayImages=false",
        "-dDownsampleMonoImages=false",
        "-dEmbedAllFonts=true",
    ]);
    if density.is_some() {
        // High-quality JPEG for converted images avoids expanding existing JPEGs
        // into huge lossless CMYK streams. Pixel dimensions are unchanged.
        command.args([
            "-dAutoFilterColorImages=false",
            "-dColorImageFilter=/DCTEncode",
            "-dAutoFilterGrayImages=false",
            "-dGrayImageFilter=/DCTEncode",
            "-dJPEGQ=95",
        ]);
    } else {
        command.args([
            "-dAutoFilterColorImages=false",
            "-dColorImageFilter=/FlateEncode",
            "-dAutoFilterGrayImages=false",
            "-dGrayImageFilter=/FlateEncode",
        ]);
    }
    command.arg(if density.is_some() {
        "-dTransferFunctionInfo=/Apply"
    } else {
        "-dTransferFunctionInfo=/Remove"
    });
    command.arg(format!("-sOutputFile={}", output.display()));
    if let Some(percent) = density {
        // Transfer functions operate on light, not ink: t(x) = 1-d + d*x.
        // Apply bakes the result into PDF colors and images; printers need not support /TR.
        command.arg("-c").arg(format!(
            "{{ {percent} 100 div mul 1 {percent} 100 div sub add }} dup dup dup setcolortransfer"
        ));
    }
    command.arg("-f").arg(input);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let result = command.output().map_err(|e| format!("Cannot start Ghostscript: {e}. Install Ghostscript for Linux/development, or reinstall Inkwell on Windows."))?;
    if !result.status.success() {
        let diagnostics = format!(
            "{} {}",
            String::from_utf8_lossy(&result.stderr),
            String::from_utf8_lossy(&result.stdout)
        );
        return Err(format!(
            "PDF conversion failed. The document may be encrypted or damaged. {}",
            diagnostics.chars().take(1600).collect::<String>()
        ));
    }
    Ok(())
}

pub fn convert(
    input: &Path,
    output: &Path,
    density: u8,
    dpi: u32,
    gs: &Path,
) -> Result<Conversion, String> {
    // dpi is retained for compatibility with older desktop clients, but pages are never rasterized.
    if density > 100 || ![300, 600].contains(&dpi) {
        return Err("Choose density 0–100 and resolution 300 or 600 DPI.".into());
    }
    if input == output
        || (output.exists() && input.canonicalize().ok() == output.canonicalize().ok())
    {
        return Err("Save to a different file to protect your original.".into());
    }
    let mut header = [0; 5];
    File::open(input)
        .and_then(|mut f| f.read_exact(&mut header))
        .map_err(|e| format!("Cannot read PDF: {e}"))?;
    if &header != b"%PDF-" {
        return Err("This file does not have a valid PDF header.".into());
    }
    let source_pages = Document::load(input)
        .map_err(|e| format!("Cannot read PDF structure: {e}"))?
        .get_pages()
        .len();
    if source_pages == 0 {
        return Err("The PDF contains no pages.".into());
    }
    let workspace = tempfile::tempdir().map_err(|e| e.to_string())?;
    let normalized = workspace.path().join("cmyk.pdf");
    // Normalize first, removing document-supplied transfer functions. This prevents
    // an input /TR from replacing the user's selected density in the second pass.
    run_pdfwrite(gs, input, &normalized, None)?;
    let adjusted = workspace.path().join("adjusted.pdf");
    run_pdfwrite(gs, &normalized, &adjusted, Some(density))?;
    let result = &adjusted;
    let pages = Document::load(result)
        .map_err(|e| format!("Cannot validate converted PDF: {e}"))?
        .get_pages()
        .len();
    if pages != source_pages {
        return Err("Conversion did not preserve every page; no output was saved.".into());
    }
    let parent = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut pending = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    std::io::copy(
        &mut File::open(result).map_err(|e| e.to_string())?,
        pending.as_file_mut(),
    )
    .map_err(|e| e.to_string())?;
    pending.as_file().sync_all().map_err(|e| e.to_string())?;
    pending
        .persist(output)
        .map_err(|e| format!("Cannot save PDF: {e}"))?;
    Ok(Conversion {
        pages,
        bytes: output.metadata().map_err(|e| e.to_string())?.len(),
        path: output.to_string_lossy().into(),
    })
}
