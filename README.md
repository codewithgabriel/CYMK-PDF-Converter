# Inkwell

A Windows and Linux document workspace built with Rust, Tauri 2 and TypeScript. **Image studio** reimagines selected images in Word documents using OpenAI; **PDF optimizer** creates CMYK PDFs with adjustable ink density.

## Windows download and updates

Get the setup executable from the [latest public release](https://github.com/codewithgabriel/CYMK-PDF-Converter/releases/latest). Close Inkwell and run the new installer to update the existing installation. New users can run the same installer. Updates are installed manually; there is no in-app auto-updater. Image generation requires the user's OpenAI API key in **AI settings**; the developer's `.env` is never distributed.

## Word image studio

Open a `.docx` file in **Image studio**. The document appears in a page preview, with a comment button beside each supported embedded image and a navigable image list. Click an image to open its inspector.

1. Choose **Realistic**, **Refine**, or **Illustrate**. Add instructions if you want; leaving them empty uses the reference image and optional nearby text.
2. Review the **Use document context** toggle and the nearby text before sending a request. Choose image quality and resolution, then click **Generate image**.
3. Compare the generated draft with the original using the comparison slider. Generate more drafts if needed. **Use this image** applies only that occurrence to the preview; other placements of the same source remain unchanged.
4. **Export DOCX** saves a new file containing only accepted replacements. **Restore original** reverses an accepted replacement. Drafts are held in memory for the current document session; export before closing.

Opening a document never generates images automatically. Generation uses the OpenAI Images Edits API from the **Rust backend**, defaults to `gpt-image-2.5-sunburst`, and returns PNG images. Standard resolution uses a 1536-pixel long edge; larger output uses 2560 pixels, subject to the model's supported aspect ratio and size limits. The larger setting is experimental. `high` and `medium` quality are selectable. There are no automatic retries of billable image requests.

### API key setup

For local development, add a key to the project-root `.env`:

```dotenv
OPENAI_API_KEY=your_api_key
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
```

The existing `OPENAI_KEY` name is also supported. `.env` is ignored by Git and is read at runtime by debug Rust builds only. It is **never bundled into the frontend or installer**. Restart the desktop process after editing it.

Packaged users can enter their own key through **AI settings**; it remains in native memory for that app session. Runtime `OPENAI_API_KEY` / `OPENAI_KEY` environment variables also work. API charges go to the connected OpenAI project. Distributing access billed to one company-owned key requires an authenticated hosted service; do not ship that shared key in a desktop executable or `.env` file.

Only the selected embedded image, the user's instructions, and optional nearby text/alternative text are sent to OpenAI, and only on Generate. The complete document is not uploaded. Local opening, preview, export, and PDF optimization do not call OpenAI.

### Document fidelity and limits

Export retains the original DOCX package and raw-copies unchanged ZIP members. It adds a PNG and a new image relationship for each accepted occurrence while retaining existing text, tables, styles, drawing geometry, page settings, headers, footers and original media. It saves atomically to a new filename. External relationships are disabled only in the preview and preserved in exports.

The preview uses `docx-preview` in an isolated shadow root. Documents without explicit page breaks are paginated locally by measuring text blocks and table rows; this is an approximation of Word layout, not a full Word editor. Complex columns, large merged rows, shapes, charts, tracked changes, fields and unusual fonts may render differently. Existing layout XML is not repaginated on export. Source pictures must be embedded PNG, JPEG or WebP for AI editing; other media are preserved with an explanatory message. Some Word vector pictures provide a raster fallback, which can be edited.

Limits: 80 MB input archive, 256 MB expanded archive, 250 detected image placements, 20 MB per editable image, 60 megapixels per source image. Signed, password-protected, macro-bearing and unsupported strict-XML files are rejected with instructions to save a suitable copy. AI can reinterpret details or text, so inspect generated drafts before accepting them; there is no guarantee of exact reconstruction or factual correctness.

### Verify the studio

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
# Install the isolated test browser once:
npx playwright install chromium
# Generates a synthetic fixture and runs UI tests with mocked API calls:
npm run test:ui
```

Optional local-only validation against a real document (no OpenAI request):

```sh
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --example inspect_docx -- /path/to/sample.docx output/sample-qa
```

One explicitly billable integration check, using a synthetic mockup, an empty prompt, and its surrounding synthetic text:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --example studio_check -- output/studio-qa --live
```

Reference: [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation).

## Color and quality

Ghostscript's `pdfwrite` device preserves text and vector drawing commands while converting colors to CMYK. A first pass removes input transfer functions and normalizes colors; a second applies the selected density directly to PDF colors and embedded images. Transfer adjustments are baked into the output, so the printer does not need to interpret PDF transfer functions. Full pages are **not** rasterized.

100% retains converted ink levels; 0% produces white printed pages. Density scales CMYK ink coverage; it is **not a measured percentage of physical printer ink saved**. Color conversion can change out-of-gamut colors. Test a page with your actual printer and paper before a large print run.

Text stays selectable and vectors stay sharp. Embedded images retain their pixel dimensions (no downsampling); converted color/gray images use high-quality JPEG at quality 95 to avoid expanding existing compressed images into huge lossless CMYK data. JPEG recompression introduces a small amount of loss and output size depends on the document. The old 300/600 DPI argument remains accepted for client compatibility but does not rasterize or resize pages; the desktop interface now always preserves original resolution.

Keep the original: this creates a print copy. Forms, links, accessibility tags, layers and metadata may change during PDF rewriting; digital signatures will not remain valid. Malformed or password-protected documents may be rejected. Live cancellation and preview are not yet implemented.

## Development

Install Node.js 22+, Rust stable, and Ghostscript 10+. Tauri desktop development also requires platform prerequisites (Windows MSVC Build Tools / WebView2; Linux WebKitGTK 4.1).

```sh
npm ci
npm run tauri dev
```

In development, Ghostscript is found on PATH (`gs` on Linux, `gswin64c` on Windows) or via `INKWELL_GS`. Windows production builds require the bundled runtime and never depend on a separate Ghostscript installation. Linux builds use system Ghostscript (`gs`); the Debian package declares it as a dependency. `npm run dev` previews the interface in a browser; file conversion requires the desktop app.

```sh
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --test conversion -- --ignored
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --bin inkwell-convert -- input.pdf output.pdf 80 300
```

## Run on Ubuntu / Debian Linux

The application source is in `/home/gabriel/Documents/CYMK-PDF-Converter`. The browser at localhost:5173 is a UI preview, not the desktop application.

Install native development prerequisites once in your own terminal (sudo may prompt for your Linux password):

```sh
sudo apt update
sudo apt install -y build-essential curl wget file libssl-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf ghostscript pkg-config
```

Rust and Node.js are already installed on the current machine. From the project folder, launch the actual app:

```sh
cd /home/gabriel/Documents/CYMK-PDF-Converter
npm ci
npm run tauri dev
```

The first launch downloads and compiles Rust dependencies; it requires internet access and may take several minutes. A separate native Inkwell window opens when compilation finishes. Stop an existing `npm run dev` preview with Ctrl+C before launching so port 5173 is available.

In the native window, choose a PDF, select 80% density, then click Save optimized PDF and choose a new destination. Open the saved file in your normal PDF viewer. Compare a colored or illustrated page with the original. At 100%, colors remain at converted strength; at 0%, output is intentionally white.

To build a Linux application and `.deb` installer:

```sh
npm run tauri build
```

Application binary: `src-tauri/target/release/inkwell`. Debian installer: `src-tauri/target/release/bundle/deb/*.deb`. Install the `.deb` using `sudo apt install ./path-to-the-generated-file.deb` so apt also resolves runtime dependencies, then launch Inkwell from the applications menu. No Windows runtime bundle is needed for Linux builds.

For a quick engine-only test without the desktop GUI:

```sh
cargo run --release --manifest-path src-tauri/Cargo.toml --no-default-features --bin inkwell-convert -- tests/Further_Mathematics_SSSC_2.pdf output/linux-test.pdf 80 300
```

The output directory must exist. Development builds omit large debug symbols to reduce disk usage.

## Build a Windows installer

On Windows x64, with 7-Zip on PATH:

```powershell
npm ci
./scripts/bundle-ghostscript.ps1
npm run tauri build
```

Installer: `src-tauri/target/release/bundle/nsis/*-setup.exe`. The installer bundles Ghostscript and the offline WebView2 installer. End users do not need Rust, Node or Ghostscript. The GitHub Actions **Windows installer** workflow runs Rust, PDF engine and interface tests, builds the installer, and checks installation and desktop startup on Windows before uploading the setup executable. A manual run produces an Actions artifact. Pushing a version tag also publishes a public GitHub release, installer checksums and the bundled runtime manifest after these checks pass. This replaces the older workflow tied to the 0.1.0 artifact. Builds are unsigned until you configure a code-signing certificate, so Windows may display a publisher warning. The automated startup check does not replace hands-on verification on a client's Windows PC.

Before tagging a release, update the version in `package.json`, both lockfiles, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`; add `release-notes/v<version>.md`. `node scripts/check-version.mjs` checks that the versions agree. Keep the application identifier and NSIS install mode unchanged so the new installer updates the existing app.

The bundle script resolves the latest official Artifex x64 release and checks its published SHA-256 digest before extraction. It records the exact release in UPSTREAM.json. Archive this manifest with releases; for reproducible release builds, pin the approved upstream release and digest instead of resolving latest.

## Distribution license

Project license: **AGPL-3.0-or-later**. Ghostscript is AGPL/commercial dual licensed. Distribute applicable license notices and corresponding source for the exact bundled Ghostscript version and this app in accordance with AGPL, or obtain appropriate commercial licensing before a proprietary release. Keep the runtime resource directories and notices intact. See https://www.ghostscript.com/licensing/ and https://www.gnu.org/licenses/agpl-3.0.html.
