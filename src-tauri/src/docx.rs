//! Read a DOCX as an OPC package and replace individual picture occurrences.
//! Unchanged ZIP members are raw-copied: document formatting is never rebuilt.
use base64::{engine::general_purpose::STANDARD, Engine};
use roxmltree::{Document, Node};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Cursor, Read, Write},
    ops::Range,
    path::{Path, PathBuf},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const MAX_FILE: u64 = 80 * 1024 * 1024;
const MAX_EXPANDED: u64 = 256 * 1024 * 1024;
const MAX_XML: usize = 12 * 1024 * 1024;
const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const IMAGE_REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Picture {
    pub id: String,
    pub label: String,
    pub part: String,
    pub alt: String,
    pub context: String,
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub supported: bool,
    pub reason: Option<String>,
    #[serde(skip)]
    pub media: String,
    #[serde(skip)]
    attribute: Range<usize>,
}

pub struct DocxPackage {
    pub original: PathBuf,
    bytes: Vec<u8>,
    pub pictures: Vec<Picture>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedImage {
    pub image_id: String,
    pub candidate_id: String,
}

#[derive(Serialize)]
pub struct Exported {
    pub path: String,
    pub bytes: u64,
    pub replacements: usize,
}

fn xml(bytes: &[u8]) -> Result<&str, String> {
    if bytes.len() > MAX_XML {
        return Err("A document XML part exceeds the 12 MB limit.".into());
    }
    std::str::from_utf8(bytes).map_err(|_| {
        "This DOCX uses unsupported XML encoding. Save it again as a modern .docx file.".into()
    })
}

fn parse(text: &str) -> Result<Document<'_>, String> {
    // roxmltree rejects DTDs by default; never resolve external entities.
    Document::parse(text).map_err(|_| {
        "The DOCX contains invalid XML. Open and save it in Word, then try again.".into()
    })
}

fn part_bytes(archive: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<Vec<u8>, String> {
    let entry = archive
        .by_name(name)
        .map_err(|_| format!("Missing document part: {name}"))?;
    let mut bytes = Vec::new();
    entry
        .take(MAX_EXPANDED + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read this DOCX archive.".to_string())?;
    if bytes.len() as u64 > MAX_EXPANDED {
        return Err("A document part expands beyond the supported size limit.".into());
    }
    Ok(bytes)
}

fn rels_name(part: &str) -> String {
    let (dir, name) = part.rsplit_once('/').unwrap_or(("", part));
    format!("{dir}/_rels/{name}.rels")
}

fn resolve_target(part: &str, target: &str) -> Option<String> {
    if target.contains(['\\', ':', '?', '#', '%']) {
        return None;
    }
    let mut components: Vec<&str> = if target.starts_with('/') {
        vec![]
    } else {
        part.rsplit_once('/')?.0.split('/').collect()
    };
    for item in target.trim_start_matches('/').split('/') {
        match item {
            "" | "." => {}
            ".." => {
                components.pop()?;
            }
            _ => components.push(item),
        }
    }
    let result = components.join("/");
    result.starts_with("word/media/").then_some(result)
}

fn local_text(node: Node<'_, '_>) -> String {
    node.descendants()
        .filter(|n| n.has_tag_name((W, "t")))
        .filter_map(|n| n.text())
        .collect::<Vec<_>>()
        .join(" ")
}

fn limited(text: &str, count: usize) -> String {
    text.chars().take(count).collect()
}

fn inspect_image(data: &[u8]) -> Result<(u32, u32, &'static str), String> {
    if data.len() > 20 * 1024 * 1024 {
        return Err("Image exceeds the 20 MB editing limit.".into());
    }
    let format = image::guess_format(data)
        .map_err(|_| "This image format cannot be edited. Use PNG, JPEG, or WebP.".to_string())?;
    let mime = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        _ => return Err("This image format cannot be edited. Use PNG, JPEG, or WebP.".into()),
    };
    let (w, h) = image::ImageReader::with_format(Cursor::new(data), format)
        .into_dimensions()
        .map_err(|_| "This image is damaged.".to_string())?;
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 60_000_000 {
        return Err("Image dimensions exceed the 60 megapixel limit.".into());
    }
    Ok((w, h, mime))
}

impl DocxPackage {
    pub fn open(path: &Path) -> Result<Self, String> {
        if !path
            .extension()
            .is_some_and(|x| x.eq_ignore_ascii_case("docx"))
        {
            return Err("Choose a .docx document.".into());
        }
        let metadata = fs::metadata(path)
            .map_err(|_| "Cannot open the document. Check that it still exists.".to_string())?;
        if !metadata.is_file() || metadata.len() > MAX_FILE {
            return Err("Choose a DOCX smaller than 80 MB.".into());
        }
        let bytes = fs::read(path).map_err(|_| "Cannot read the document.".to_string())?;
        Self::from_bytes(path.to_path_buf(), bytes)
    }

    pub fn from_bytes(original: PathBuf, bytes: Vec<u8>) -> Result<Self, String> {
        if bytes.len() as u64 > MAX_FILE {
            return Err("Choose a DOCX smaller than 80 MB.".into());
        }
        let mut archive = ZipArchive::new(Cursor::new(bytes.as_slice()))
            .map_err(|_| "This is not a valid DOCX, or it is password protected.".to_string())?;
        if archive.len() > 6000 {
            return Err("This DOCX has too many archive parts.".into());
        }
        let mut names = HashSet::new();
        let mut total = 0u64;
        for i in 0..archive.len() {
            let entry = archive
                .by_index(i)
                .map_err(|_| "This DOCX archive is damaged.".to_string())?;
            if entry.enclosed_name().is_none()
                || entry.name().contains('\\')
                || !names.insert(entry.name().to_string())
            {
                return Err("The DOCX contains unsafe or duplicate archive paths.".into());
            }
            total = total
                .checked_add(entry.size())
                .ok_or("This DOCX is too large.")?;
            if total > MAX_EXPANDED {
                return Err("The expanded DOCX exceeds the 256 MB limit.".into());
            }
        }
        if !names.contains("word/document.xml") || !names.contains("[Content_Types].xml") {
            return Err("The file is not a Word DOCX document.".into());
        }
        let mut warnings = vec![];
        if names
            .iter()
            .any(|n| n.contains("vbaProject") || n.starts_with("_xmlsignatures/"))
        {
            return Err("Signed or macro-bearing documents are not supported. Save an unsigned, macro-free .docx copy first.".into());
        }
        let mut parts: Vec<_> = names
            .iter()
            .filter(|n| {
                n.starts_with("word/")
                    && n.ends_with(".xml")
                    && !n[5..].contains('/')
                    && (n.as_str() == "word/document.xml"
                        || n.starts_with("word/header")
                        || n.starts_with("word/footer")
                        || n.as_str() == "word/footnotes.xml"
                        || n.as_str() == "word/endnotes.xml")
            })
            .cloned()
            .collect();
        parts.sort_by_key(|p| (p != "word/document.xml", p.clone()));
        let mut pictures = vec![];
        for part in parts {
            let raw = part_bytes(&mut archive, &part)?;
            let document = parse(xml(&raw)?)?;
            if part == "word/document.xml"
                && document.root_element().tag_name().namespace() != Some(W)
            {
                return Err("This document uses an unsupported Word XML format. Save it as a standard Word .docx file and try again.".into());
            }
            let relationships = if names.contains(&rels_name(&part)) {
                part_bytes(&mut archive, &rels_name(&part))?
            } else {
                format!("<Relationships xmlns=\"{REL_NS}\"/>").into_bytes()
            };
            let rel_doc = parse(xml(&relationships)?)?;
            let paragraphs: Vec<_> = document
                .descendants()
                .filter(|n| n.has_tag_name((W, "p")))
                .collect();
            let blips: Vec<_> = document
                .descendants()
                .filter(|n| n.has_tag_name((A, "blip")) || n.tag_name().name() == "imagedata")
                .collect();
            for blip in blips {
                // Both modern DrawingML and legacy VML pictures are supported.
                let attribute = blip.attributes().find(|a| {
                    a.namespace() == Some(R) && (a.name() == "embed" || a.name() == "id")
                });
                let Some(attribute) = attribute else {
                    warnings
                        .push("A linked image was skipped; embed it in Word to edit it.".into());
                    continue;
                };
                let Some(rel) = rel_doc.descendants().find(|n| {
                    n.attribute("Id") == Some(attribute.value())
                        && n.attribute("Type").is_some_and(|t| t.ends_with("/image"))
                }) else {
                    continue;
                };
                if rel.attribute("TargetMode") == Some("External") {
                    warnings.push("An externally linked image was skipped.".into());
                    continue;
                }
                let Some(media) = rel
                    .attribute("Target")
                    .and_then(|target| resolve_target(&part, target))
                else {
                    warnings.push("An image outside the media folder was skipped.".into());
                    continue;
                };
                let data = part_bytes(&mut archive, &media)?;
                let details = inspect_image(&data);
                let (width, height, mime, reason) = match details {
                    Ok((w, h, m)) => (w, h, m, None),
                    Err(e) => (0, 0, "", Some(e)),
                };
                let container = blip
                    .ancestors()
                    .find(|n| n.has_tag_name((W, "drawing")) || n.has_tag_name((W, "pict")))
                    .unwrap_or(blip);
                let alt = container
                    .descendants()
                    .find(|n| n.tag_name().name() == "docPr")
                    .and_then(|n| n.attribute("descr").or_else(|| n.attribute("title")))
                    .unwrap_or("");
                let paragraph = blip.ancestors().find(|n| n.has_tag_name((W, "p")));
                let index = paragraph
                    .and_then(|p| paragraphs.iter().position(|n| *n == p))
                    .unwrap_or(0);
                let context = paragraphs
                    [index.saturating_sub(2)..(index + 3).min(paragraphs.len())]
                    .iter()
                    .map(|p| local_text(*p))
                    .filter(|s| !s.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join("\n");
                pictures.push(Picture {
                    id: format!("image-{}", pictures.len() + 1),
                    label: format!("Image {:02}", pictures.len() + 1),
                    part: part.clone(),
                    alt: limited(alt, 800),
                    context: limited(&context, 3500),
                    data_url: if reason.is_none() {
                        format!("data:{mime};base64,{}", STANDARD.encode(&data))
                    } else {
                        String::new()
                    },
                    width,
                    height,
                    supported: reason.is_none(),
                    reason,
                    media,
                    attribute: attribute.range(),
                });
                if pictures.len() > 250 {
                    return Err("This document has more than 250 images. Split it into smaller documents first.".into());
                }
            }
        }
        warnings.sort();
        warnings.dedup();
        if pictures.iter().any(|p| !p.supported) {
            warnings.push("Some image formats cannot be edited. Those images will be preserved in the exported document.".into());
        }
        Ok(Self {
            original,
            bytes,
            pictures,
            warnings,
        })
    }

    pub fn source_image(&self, id: &str) -> Result<(Picture, Vec<u8>), String> {
        let picture = self
            .pictures
            .iter()
            .find(|p| p.id == id)
            .ok_or("The selected image no longer exists.")?;
        if !picture.supported {
            return Err(picture
                .reason
                .clone()
                .unwrap_or("Unsupported image.".into()));
        }
        let mut archive = ZipArchive::new(Cursor::new(self.bytes.as_slice()))
            .map_err(|_| "Invalid document.".to_string())?;
        Ok((picture.clone(), part_bytes(&mut archive, &picture.media)?))
    }

    /// Preview-only unique relationship IDs let the UI identify each occurrence,
    /// even if several drawings reference the same embedded image.
    pub fn preview(&self) -> Result<Vec<u8>, String> {
        let replacements: BTreeMap<_, _> =
            self.pictures.iter().map(|p| (p.id.clone(), None)).collect();
        self.rewrite(&replacements, true)
    }

    pub fn export(
        &self,
        path: &Path,
        replacements: &BTreeMap<String, Vec<u8>>,
    ) -> Result<Exported, String> {
        if !path
            .extension()
            .is_some_and(|x| x.eq_ignore_ascii_case("docx"))
        {
            return Err("Save the result with a .docx extension.".into());
        }
        let source = fs::canonicalize(&self.original).ok();
        let destination = fs::canonicalize(path).ok();
        if path == self.original || source.is_some() && source == destination {
            return Err("Choose a new filename to keep the original document.".into());
        }
        if let (Ok(a), Ok(b)) = (fs::metadata(&self.original), fs::metadata(path)) {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if a.dev() == b.dev() && a.ino() == b.ino() {
                    return Err(
                        "The destination is the original document. Choose a new filename.".into(),
                    );
                }
            }
            #[cfg(not(unix))]
            {
                let _ = (a, b);
            }
        }
        for (id, data) in replacements {
            if !self.pictures.iter().any(|p| p.id == *id && p.supported) {
                return Err("An image replacement does not belong to this document.".into());
            }
            let (_, _, mime) = inspect_image(data)?;
            if mime != "image/png" {
                return Err("Generated replacements must be PNG images.".into());
            }
        }
        let edits = replacements
            .iter()
            .map(|(id, bytes)| (id.clone(), Some(bytes.clone())))
            .collect();
        let output = self.rewrite(&edits, false)?;
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let mut tmp = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| "Cannot write to this folder.".to_string())?;
        tmp.write_all(&output)
            .and_then(|_| tmp.as_file().sync_all())
            .map_err(|_| "Cannot save the DOCX. Check free disk space.".to_string())?;
        tmp.persist(path).map_err(|_| {
            "Cannot replace the destination file. Close it in Word and try again.".to_string()
        })?;
        Ok(Exported {
            path: path.display().to_string(),
            bytes: output.len() as u64,
            replacements: replacements.len(),
        })
    }

    fn rewrite(
        &self,
        replacements: &BTreeMap<String, Option<Vec<u8>>>,
        preview: bool,
    ) -> Result<Vec<u8>, String> {
        let mut archive = ZipArchive::new(Cursor::new(self.bytes.as_slice()))
            .map_err(|_| "Invalid document.".to_string())?;
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let mut modified: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        let mut by_part: BTreeMap<&str, Vec<&Picture>> = BTreeMap::new();
        for picture in &self.pictures {
            if replacements.contains_key(&picture.id) {
                by_part.entry(&picture.part).or_default().push(picture);
            }
        }
        for (part, pictures) in by_part {
            let raw = part_bytes(&mut archive, part)?;
            let original_xml = xml(&raw)?;
            let original_doc = parse(original_xml)?;
            let mut text = original_xml.to_string();
            let relationships = part_bytes(&mut archive, &rels_name(part))?;
            let mut rels = xml(&relationships)?.to_string();
            let mut edits = vec![];
            let mut additions = String::new();
            for picture in pictures {
                let rid = if preview {
                    format!("inkwellPreview-{}", picture.id)
                } else {
                    format!("inkwell{nonce}{}", picture.id)
                };
                let old_attribute = &original_xml[picture.attribute.clone()];
                let attr_name = old_attribute
                    .split('=')
                    .next()
                    .ok_or("Invalid image relationship.")?
                    .trim();
                edits.push((picture.attribute.clone(), format!("{attr_name}=\"{rid}\"")));
                if !preview {
                    // Word prefers an SVG extension over the raster fallback.
                    // Remove that extension when its picture becomes a generated PNG.
                    if let Some(blip) = original_doc
                        .descendants()
                        .find(|n| n.attributes().any(|a| a.range() == picture.attribute))
                    {
                        for extension in blip.descendants().filter(|n| {
                            n.has_tag_name((A, "ext"))
                                && n.descendants().any(|c| c.tag_name().name() == "svgBlip")
                        }) {
                            edits.push((extension.range(), String::new()));
                        }
                    }
                }
                let target = if preview {
                    picture
                        .media
                        .strip_prefix("word/")
                        .ok_or("Invalid image path.")?
                        .to_string()
                } else {
                    let name = format!("media/inkwell-{nonce}-{}.png", picture.id);
                    modified.insert(
                        format!("word/{name}"),
                        replacements[&picture.id]
                            .clone()
                            .ok_or("Missing replacement image.")?,
                    );
                    name
                };
                additions.push_str(&format!("<Relationship xmlns=\"{REL_NS}\" Id=\"{rid}\" Type=\"{IMAGE_REL}\" Target=\"{}\"/>", escape_xml(&target)));
            }
            edits.sort_by_key(|e| std::cmp::Reverse(e.0.start));
            for (range, value) in edits {
                text.replace_range(range, &value);
            }
            insert_children(&mut rels, &additions)?;
            modified.insert(part.to_string(), text.into_bytes());
            modified.insert(rels_name(part), rels.into_bytes());
        }
        if !preview && !replacements.is_empty() {
            let raw = part_bytes(&mut archive, "[Content_Types].xml")?;
            let mut content = xml(&raw)?.to_string();
            let additions = modified.keys().filter(|p| p.starts_with("word/media/")).map(|p| format!("<Override xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\" PartName=\"/{}\" ContentType=\"image/png\"/>", escape_xml(p))).collect::<String>();
            insert_children(&mut content, &additions)?;
            modified.insert("[Content_Types].xml".into(), content.into_bytes());
        }
        // Never load external resources in the preview. This does not change the export.
        if preview {
            let rel_names: Vec<_> = archive
                .file_names()
                .filter(|n| n.ends_with(".rels"))
                .map(str::to_string)
                .collect();
            for name in rel_names {
                let raw = match modified.get(&name) {
                    Some(x) => x.clone(),
                    None => part_bytes(&mut archive, &name)?,
                };
                let mut text = xml(&raw)?.to_string();
                let doc = parse(&text)?;
                let mut ranges: Vec<_> = doc
                    .descendants()
                    .filter(|n| n.attribute("TargetMode") == Some("External"))
                    .map(|n| n.range())
                    .collect();
                ranges.sort_by_key(|r| std::cmp::Reverse(r.start));
                for range in ranges {
                    text.replace_range(range, "");
                }
                modified.insert(name, text.into_bytes());
            }
        }
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for i in 0..archive.len() {
            let entry = archive
                .by_index(i)
                .map_err(|_| "Invalid DOCX archive.".to_string())?;
            if let Some(data) = modified.remove(entry.name()) {
                writer
                    .start_file(entry.name(), options)
                    .map_err(|e| e.to_string())?;
                writer.write_all(&data).map_err(|e| e.to_string())?;
            } else {
                writer.raw_copy_file(entry).map_err(|e| e.to_string())?;
            }
        }
        for (name, data) in modified {
            writer
                .start_file(name, options)
                .map_err(|e| e.to_string())?;
            writer.write_all(&data).map_err(|e| e.to_string())?;
        }
        Ok(writer.finish().map_err(|e| e.to_string())?.into_inner())
    }
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn insert_children(text: &mut String, children: &str) -> Result<(), String> {
    let doc = parse(text)?;
    let root = doc.root_element();
    let range = root.range();
    if text[..range.end].ends_with("/>") {
        let tag_start = range.start + 1;
        let tag_end = text[tag_start..]
            .find(|c: char| c.is_whitespace() || c == '/' || c == '>')
            .ok_or("Invalid XML root.")?
            + tag_start;
        let tag = text[tag_start..tag_end].to_string();
        text.replace_range(range.end - 2..range.end, &format!(">{children}</{tag}>"));
    } else {
        let end = text[..range.end].rfind("</").ok_or("Invalid XML root.")?;
        text.insert_str(end, children);
    }
    Ok(())
}
