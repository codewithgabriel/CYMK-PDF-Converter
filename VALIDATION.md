# Validation of the vector-preserving ink optimizer

The earlier full-page TIFF/raster pipeline has been removed. PDF conversion now uses Ghostscript pdfwrite in two passes: CMYK normalization with input transfer functions removed, then density application with transfer functions baked into colors and images. There is no page-resolution conversion. Embedded images retain their dimensions and use high-quality JPEG compression (quality 95); text and drawing commands remain PDF objects.

Passed:

- Full native desktop compilation check: `cargo check --manifest-path src-tauri/Cargo.toml --offline --features desktop`.
- Supplied textbook: 153 pages, input 8,653,410 bytes, new output 10,485,012 bytes at 80% density (previous raster output was 204,635,399 bytes). All 133 embedded image pixel dimensions are unchanged. Extractable text remains; Poppler inspection of pages 5 and 25 confirms the photo, equations, tables and graphs render in color without black images.

- Production frontend build (`npm run build`), including TypeScript checks.
- Rust formatting check.
- `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --offline --test conversion -- --include-ignored`.
- Mixed RGB-image / CMYK-vector / text / transparency fixture: text stays extractable, image dimensions stay at 2×2 instead of becoming page rasters, both pages survive, and original overwrite is rejected.
- Textbook page 25: measured C/M/Y/K coverage changed from 3.98332/8.93593/6.47042/4.91018 to 3.20068/7.17743/5.16573/3.92116 at 80% density, approximately a 20% reduction in each channel.
- Independent Ghostscript `ink_cov` rendering verifies approximately 50% CMYK coverage at 50% density and zero at 0%, compared with 100% output. This measures digital ink coverage, not physical printer consumption.
- Independent Poppler renders at 100%, 50% and 0% were visually inspected. Colors remain colored, transparent pixels stay white, and density reduces as expected.

The Windows installer and physical printer consumption remain unverified. PDF rewriting can change interactive features and invalidates digital signatures; keep the original.
