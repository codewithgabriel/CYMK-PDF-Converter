use lopdf::{dictionary, Document, Object, Stream};
use std::{path::Path, process::Command};
fn fixture(path: &Path) {
    let mut doc = Document::with_version("1.7");
    let pages = doc.new_object_id();
    let font =
        doc.add_object(dictionary! {"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica"});
    let mask = doc.add_object(Stream::new(dictionary! {"Type"=>"XObject","Subtype"=>"Image","Width"=>2,"Height"=>2,"ColorSpace"=>"DeviceGray","BitsPerComponent"=>8},vec![255,255,0,255]));
    let image = doc.add_object(Stream::new(dictionary! {"Type"=>"XObject","Subtype"=>"Image","Width"=>2,"Height"=>2,"ColorSpace"=>"DeviceRGB","BitsPerComponent"=>8,"SMask"=>mask},vec![255,0,0,0,255,0,0,0,255,255,255,255]));
    let mut kids = vec![];
    for (w, h) in [(144, 144), (216, 144)] {
        let content = doc.add_object(Stream::new(dictionary!{},b"q 72 0 0 72 0 0 cm /Photo Do Q 0 1 0 0 k 80 20 40 40 re f 0 0 0 1 k BT /F1 12 Tf 10 110 Td (Selectable text) Tj ET".to_vec()));
        kids.push(Object::Reference(doc.add_object(dictionary!{"Type"=>"Page","Parent"=>pages,"MediaBox"=>vec![0.into(),0.into(),w.into(),h.into()],"Resources"=>dictionary!{"XObject"=>dictionary!{"Photo"=>image},"Font"=>dictionary!{"F1"=>font}},"Contents"=>content})));
    }
    doc.objects.insert(
        pages,
        Object::Dictionary(dictionary! {"Type"=>"Pages","Count"=>2,"Kids"=>kids}),
    );
    let root = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages});
    doc.trailer.set("Root", root);
    doc.save(path).unwrap();
}
fn coverage(gs: &Path, pdf: &Path) -> Vec<[f64; 4]> {
    let result = Command::new(gs)
        .args([
            "-q",
            "-dBATCH",
            "-dNOPAUSE",
            "-sDEVICE=ink_cov",
            "-sOutputFile=-",
        ])
        .arg(pdf)
        .output()
        .unwrap();
    assert!(result.status.success());
    String::from_utf8_lossy(&result.stdout)
        .lines()
        .filter(|l| l.contains("CMYK OK"))
        .map(|l| {
            let v: Vec<f64> = l
                .split_whitespace()
                .take(4)
                .map(|x| x.parse().unwrap())
                .collect();
            [v[0], v[1], v[2], v[3]]
        })
        .collect()
}
#[test]
#[ignore = "Requires Ghostscript"]
fn preserves_text_vectors_and_image_dimensions_while_reducing_ink() {
    let tmp = tempfile::tempdir().unwrap();
    let source = tmp.path().join("source.pdf");
    fixture(&source);
    let gs = std::env::var("INKWELL_GS").unwrap_or("gs".into());
    let gs = Path::new(&gs);
    let mut full = vec![];
    for density in [100, 50, 0] {
        let output = tmp.path().join(format!("density-{density}.pdf"));
        assert_eq!(
            inkwell::convert(&source, &output, density, 300, gs)
                .unwrap()
                .pages,
            2
        );
        let doc = Document::load(&output).unwrap();
        assert!(doc
            .extract_text(&[1, 2])
            .unwrap()
            .contains("Selectable text"));
        for image in doc
            .objects
            .values()
            .filter_map(|v| v.as_stream().ok())
            .filter(|s| {
                s.dict.get(b"Subtype").ok().and_then(|v| v.as_name().ok()) == Some(b"Image")
            })
        {
            assert_eq!(
                image.dict.get(b"Width").unwrap().as_i64().unwrap(),
                2,
                "No full-page rasterization"
            );
        }
        let inks = coverage(gs, &output);
        assert_eq!(inks.len(), 2);
        if density == 100 {
            assert!(inks[0][1] > 5.);
            assert!(inks[0][3] > 0.);
            full = inks;
        } else {
            for (actual, baseline) in inks.iter().zip(&full) {
                for (a, b) in actual.iter().zip(baseline) {
                    let expected = b * density as f64 / 100.;
                    assert!(
                        (a - expected).abs() < 0.3,
                        "density {density}: {a} vs {expected}"
                    );
                }
            }
        }
        if let Ok(directory) = std::env::var("INKWELL_TEST_OUTPUT") {
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::copy(
                &output,
                Path::new(&directory).join(format!("vector-{density}.pdf")),
            )
            .unwrap();
        }
    }
    assert!(inkwell::convert(&source, &source, 80, 300, gs).is_err());
}
#[test]
fn rejects_invalid_settings_and_non_pdf_before_launching_engine() {
    let tmp = tempfile::tempdir().unwrap();
    let source = tmp.path().join("invalid.pdf");
    std::fs::write(&source, b"not a PDF").unwrap();
    let output = tmp.path().join("out.pdf");
    let gs = Path::new("missing-engine");
    assert!(inkwell::convert(&source, &output, 101, 300, gs).is_err());
    assert!(inkwell::convert(&source, &output, 80, 300, gs)
        .unwrap_err()
        .contains("header"));
    assert!(!output.exists());
}
