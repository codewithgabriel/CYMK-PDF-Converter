# Inkwell

A local Windows and Linux desktop PDF ink optimizer built with Rust, Tauri 2 and TypeScript. Choose a PDF, set **ink density from 0–100%**, retain original detail, and save a separate CMYK PDF.

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

Installer: `src-tauri/target/release/bundle/nsis/*-setup.exe`. The installer bundles Ghostscript and the offline WebView2 installer. End users do not need Rust, Node or Ghostscript. The GitHub Actions **Windows installer** workflow performs this build and uploads the setup executable; invoke it manually or push a version tag. Builds are unsigned until you configure a code-signing certificate, so Windows may display a publisher warning. A Windows installer must still be built and exercised on a clean Windows PC before release; a Linux conversion test does not validate Windows installation.

The bundle script resolves the latest official Artifex x64 release and checks its published SHA-256 digest before extraction. It records the exact release in UPSTREAM.json. Archive this manifest with releases; for reproducible release builds, pin the approved upstream release and digest instead of resolving latest.

## Distribution license

Project license: **AGPL-3.0-or-later**. Ghostscript is AGPL/commercial dual licensed. Distribute applicable license notices and corresponding source for the exact bundled Ghostscript version and this app in accordance with AGPL, or obtain appropriate commercial licensing before a proprietary release. Keep the runtime resource directories and notices intact. See https://www.ghostscript.com/licensing/ and https://www.gnu.org/licenses/agpl-3.0.html.
