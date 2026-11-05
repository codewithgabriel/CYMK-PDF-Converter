# Validation

## DOCX image studio — 5 November 2026

- The Rust desktop executable compiled locally, with frontend TypeScript and production Vite build checks.
- Seven Rust DOCX tests pass, covering independent image placements sharing one media file, header replacement, unchanged-package export, unsafe ZIP input, candidate/session ownership, context inclusion/exclusion, SVG override removal, and API dimension constraints. Clippy passes with warnings denied.
- Six headless interface tests pass, using the real Rust-generated DOCX preview package and mocking only native IPC/OpenAI responses. They cover opening, image comment controls, empty/custom prompts, context opt-out, comparison, acceptance, restoring originals, exporting only accepted drafts, failure recovery, continuous-document pagination, minimum-window layout, and the private edition generating without an API key entry step.
- The optional private-key configuration test passes with a dummy key. The public configuration remains separate; neither exposes a key value through the status command.
- A single real OpenAI Images Edits request used a synthetic 640 × 400 mockup with an empty user prompt and synthetic nearby text. `gpt-image-2.5-sunburst` returned a 1536 × 960 PNG. The photorealistic output was visually inspected and successfully exported as one replacement in a new DOCX. No private document was sent for this check.
- User-provided `Beauty_and_Cosmetology_JSSC2.docx`: 28.24 MB, 71 JPEG media files, 78 image placements, 5,480 paragraphs, 344 tables. All 78 images were detected and supported. It has no explicit or cached page breaks; local preview pagination produced 164 pages, with 78 comment buttons and no JavaScript errors. Opening and layout in the isolated headless QA session took approximately 22 seconds. The page count is a preview estimate, not a claim about Word's pagination.
- Every expanded ZIP member in an unmodified export of the supplied sample matched the original byte-for-byte. Its original file was not changed. Selected pages and image navigation were visually inspected; this is not a complete page-by-page Word rendering comparison.
- `.env` is ignored and loaded at runtime by debug Rust builds. Public installers do not include its key. The requested two-person private edition separately opts into a key supplied by a secure build secret; its executable must stay private. The key is never returned to the frontend or placed in exported documents.

The private Windows 0.2.0 installer was built from `93b4987eb311d03c5f71a1fb206a2ee87c1066bf` and published only in the private build repository. Windows CI passed the Rust tests, the bundled Ghostscript integration test, all six interface tests, the included-key check (without logging the key), silent installation, and desktop startup. Build run: `41948092458`.

A separate Windows job downloaded both released installers, verified their checksums, installed 0.1.0, upgraded to 0.2.0 in the same directory without a manual uninstall, and launched the updated desktop app successfully. Upgrade run: `41950355286`. These are automated runner checks; hands-on use on each recipient's Windows PC and generated-image fidelity still require review. Browser-based DOCX layout can differ from Word.

Private installer: `Inkwell_0.2.0_x64-setup.exe`, 286,866,743 bytes. SHA-256: `bf7bb6d1809475cf793ce39f1ad8954f28afc2580cc491727157e9af8fa5066f`. The key-bearing installer is not in the public repository's releases. An expiring asset download URL was checked without GitHub authentication; such links must not be treated as permanent public downloads.

## Vector-preserving PDF ink optimizer

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

Windows installation, startup, and the bundled PDF engine passed automated checks. Physical printer consumption remains unverified. PDF rewriting can change interactive features and invalidates digital signatures; keep the original.
