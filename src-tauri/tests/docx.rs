mod support;
use inkwell::{
    docx::DocxPackage,
    studio::{api_error, build_prompt, output_size, GenerateRequest, Studio},
};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
    path::Path,
};

fn entries(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut e = zip.by_index(i).unwrap();
            let name = e.name().to_owned();
            let mut b = vec![];
            e.read_to_end(&mut b).unwrap();
            (name, b)
        })
        .collect()
}

#[test]
fn replaces_only_accepted_occurrence_and_preserves_document_parts() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source.docx");
    let output = dir.path().join("edited.docx");
    let bytes = support::document();
    std::fs::write(&input, &bytes).unwrap();
    let package = DocxPackage::open(&input).unwrap();
    assert_eq!(package.pictures.len(), 3);
    assert!(package.pictures[0].context.contains("oak desk"));
    let mut edits = BTreeMap::new();
    edits.insert("image-1".into(), support::picture(true));
    let result = package.export(&output, &edits).unwrap();
    assert_eq!(result.replacements, 1);
    let reopened = DocxPackage::open(&output).unwrap();
    assert_eq!(reopened.pictures.len(), 3);
    assert_ne!(reopened.pictures[0].data_url, package.pictures[0].data_url);
    assert_eq!(reopened.pictures[1].data_url, package.pictures[1].data_url);
    assert_eq!(reopened.pictures[2].data_url, package.pictures[2].data_url);
    let original_parts = entries(&bytes);
    let new_parts = entries(&std::fs::read(output).unwrap());
    for (name, original) in &original_parts {
        if ![
            "word/document.xml",
            "word/_rels/document.xml.rels",
            "[Content_Types].xml",
        ]
        .contains(&name.as_str())
        {
            assert_eq!(new_parts[name], *original, "Unmodified part {name}");
        }
    }
    let text = |b: &[u8]| {
        let s = std::str::from_utf8(b).unwrap();
        let d = roxmltree::Document::parse(s).unwrap();
        d.descendants()
            .filter(|n| n.tag_name().name() == "t")
            .filter_map(|n| n.text())
            .collect::<String>()
    };
    assert_eq!(
        text(&original_parts["word/document.xml"]),
        text(&new_parts["word/document.xml"])
    );
    assert_eq!(
        std::fs::read(&input).unwrap(),
        bytes,
        "Original file must be unchanged"
    );
    assert!(package.export(&input, &edits).is_err());
    assert!(package
        .export(&dir.path().join("edited.pdf"), &edits)
        .is_err());
}

#[test]
fn preview_ids_are_unique_and_external_resources_only_removed_from_preview() {
    let bytes = support::document();
    let package = DocxPackage::from_bytes("source.docx".into(), bytes.clone()).unwrap();
    let preview = entries(&package.preview().unwrap());
    let doc = String::from_utf8(preview["word/document.xml"].clone()).unwrap();
    assert!(doc.contains("inkwellPreview-image-1"));
    assert!(doc.contains("inkwellPreview-image-2"));
    assert!(
        !String::from_utf8_lossy(&preview["word/_rels/document.xml.rels"])
            .contains("example.invalid")
    );
    assert!(
        String::from_utf8_lossy(&entries(&bytes)["word/_rels/document.xml.rels"])
            .contains("example.invalid")
    );
    for (name, bytes) in preview {
        if name.ends_with(".xml") || name.ends_with(".rels") {
            roxmltree::Document::parse(std::str::from_utf8(&bytes).unwrap()).unwrap();
        }
    }
}

#[test]
fn header_replacement_and_no_changes_export_are_valid() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("source.docx");
    std::fs::write(&path, support::document()).unwrap();
    let package = DocxPackage::open(&path).unwrap();
    let copy = tmp.path().join("copy.docx");
    package.export(&copy, &BTreeMap::new()).unwrap();
    assert_eq!(
        entries(&std::fs::read(&copy).unwrap()),
        entries(&support::document())
    );
    let mut replacements = BTreeMap::new();
    replacements.insert("image-3".into(), support::picture(true));
    package.export(&copy, &replacements).unwrap();
    let reopened = DocxPackage::open(&copy).unwrap();
    assert_eq!(reopened.pictures[0].data_url, package.pictures[0].data_url);
    assert_ne!(reopened.pictures[2].data_url, package.pictures[2].data_url);
}

#[test]
fn rejects_unsafe_archives_and_unsigned_macro_requirement() {
    assert!(DocxPackage::from_bytes("test.docx".into(), b"not zip".to_vec()).is_err());
    let unsafe_zip = support::archive(&[("../escape", vec![])]);
    assert!(DocxPackage::from_bytes("test.docx".into(), unsafe_zip).is_err());
    let mut parts = entries(&support::document());
    parts.insert("word/vbaProject.bin".into(), vec![]);
    let entries: Vec<_> = parts.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
    assert!(DocxPackage::from_bytes("test.docx".into(), support::archive(&entries)).is_err());
}

#[test]
fn validates_candidate_ownership_and_optional_context() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("source.docx");
    std::fs::write(&path, support::document()).unwrap();
    let service = Studio::default();
    let opened = service.open(&path).unwrap();
    assert!(service.export("wrong", Path::new("out.docx"), &[]).is_err());
    assert!(service
        .export(
            &opened.session_id,
            Path::new("out.docx"),
            &[inkwell::docx::AcceptedImage {
                image_id: "image-1".into(),
                candidate_id: "invented".into()
            }]
        )
        .is_err());
    let mut request = GenerateRequest {
        session_id: opened.session_id,
        image_id: "image-1".into(),
        prompt: "".into(),
        use_context: false,
        style: "realistic".into(),
        quality: "high".into(),
        resolution: "standard".into(),
    };
    let prompt = build_prompt(&request, &opened.images[0]);
    assert!(!prompt.contains("quiet workspace"));
    assert!(prompt.contains("photorealistic"));
    request.use_context = true;
    assert!(build_prompt(&request, &opened.images[0]).contains("quiet workspace"));
    assert!(
        service.generate(request).is_err(),
        "No API key: no paid request"
    );
}

#[test]
fn output_sizes_follow_api_limits_and_errors_are_actionable() {
    for (w, h) in [(400, 300), (300, 400), (100, 100), (10000, 10), (10, 10000)] {
        for resolution in ["standard", "large"] {
            let size = output_size(w, h, resolution, "gpt-image-2.5-sunburst");
            let values: Vec<u32> = size.split('x').map(|s| s.parse().unwrap()).collect();
            assert_eq!(values[0] % 16, 0);
            assert_eq!(values[1] % 16, 0);
            assert!(values[0] <= values[1] * 3 && values[1] <= values[0] * 3);
            assert!(values[0] * values[1] >= 655360);
            assert!(values[0] * values[1] <= 8294400);
        }
    }
    assert_eq!(output_size(640, 400, "large", "gpt-image-1.5"), "1536x1024");
    assert!(api_error(429, "insufficient_quota").contains("credit"));
    assert!(api_error(401, "").contains("key"));
}

#[test]
fn replacing_a_vector_picture_fallback_removes_the_old_svg_override() {
    let mut original = entries(&support::document());
    let text = String::from_utf8(original["word/document.xml"].clone()).unwrap();
    let text = text.replacen("<a:blip r:embed=\"rIdImage\"/>", "<a:blip r:embed=\"rIdImage\"><a:extLst><a:ext uri=\"svg\"><svgBlip xmlns=\"http://schemas.microsoft.com/office/drawing/2016/SVG/main\" r:embed=\"rIdImage\"/></a:ext></a:extLst></a:blip>", 1);
    original.insert("word/document.xml".into(), text.into_bytes());
    let members: Vec<_> = original
        .iter()
        .map(|(name, bytes)| (name.as_str(), bytes.clone()))
        .collect();
    let package =
        DocxPackage::from_bytes("source.docx".into(), support::archive(&members)).unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let output = tmp.path().join("replaced.docx");
    package
        .export(
            &output,
            &BTreeMap::from([("image-1".into(), support::picture(true))]),
        )
        .unwrap();
    let edited = entries(&std::fs::read(output).unwrap());
    assert!(!String::from_utf8_lossy(&edited["word/document.xml"]).contains("svgBlip"));
    roxmltree::Document::parse(std::str::from_utf8(&edited["word/document.xml"]).unwrap()).unwrap();
}
