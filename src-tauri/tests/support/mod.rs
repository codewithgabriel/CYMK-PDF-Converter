use std::io::{Cursor, Write};
use zip::{write::SimpleFileOptions, ZipWriter};

pub fn picture(alternate: bool) -> Vec<u8> {
    // A synthetic mockup, never a user's document or image.
    let mut image = image::RgbImage::from_pixel(640, 400, image::Rgb([239, 226, 204]));
    for (x, y, p) in image.enumerate_pixels_mut() {
        let color = if y > 328 {
            [205, 178, 143]
        } else if (55..250).contains(&x) && (30..260).contains(&y) {
            if !(65..=240).contains(&x) || !(40..=250).contains(&y) || (148..156).contains(&x) {
                [170, 157, 128]
            } else {
                [184, 204, 183]
            }
        } else if (190..590).contains(&x) && (282..303).contains(&y) {
            [157, 116, 76]
        } else if ((215..232).contains(&x) || (550..567).contains(&x)) && y >= 303 {
            [151, 111, 72]
        } else if (395..445).contains(&x) && (220..282).contains(&y) {
            [176, 135, 99]
        } else if (418..425).contains(&x) && (110..240).contains(&y) {
            [108, 137, 80]
        } else if ((x as i32 - 397).pow(2) / 4 + (y as i32 - 170).pow(2)) < 530 {
            [125, 153, 94]
        } else if ((x as i32 - 446).pow(2) / 4 + (y as i32 - 136).pow(2)) < 430 {
            [110, 141, 82]
        } else if (278..340).contains(&x) && (250..281).contains(&y) {
            if alternate {
                [106, 134, 152]
            } else {
                [226, 216, 192]
            }
        } else {
            continue;
        };
        *p = image::Rgb(color);
    }
    let mut bytes = Cursor::new(vec![]);
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

pub fn archive(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(vec![]));
    for (name, data) in entries {
        writer
            .start_file(
                *name,
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
        writer.write_all(data).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn drawing(id: usize, width: u32, height: u32) -> String {
    format!(
        r#"<w:p><w:pPr><w:spacing w:after="180"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{width}" cy="{height}"/><wp:docPr id="{id}" name="Picture {id}" descr="An oak desk with a plant beside a sunlit window"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="{id}" name="Reference mockup"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#
    )
}

pub fn document() -> Vec<u8> {
    let namespaces = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture""#;
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><w:document {namespaces}><w:body>
      <w:p><w:pPr><w:spacing w:after="220"/></w:pPr><w:r><w:rPr><w:color w:val="85966C"/><w:sz w:val="18"/></w:rPr><w:t>SPACES FOR SLOWER LIVING</w:t></w:r></w:p>
      <w:p><w:pPr><w:spacing w:after="220"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:color w:val="36513A"/><w:sz w:val="60"/></w:rPr><w:t>A little room to breathe.</w:t></w:r></w:p>
      <w:p><w:pPr><w:spacing w:after="300" w:line="320"/></w:pPr><w:r><w:t>A quiet workspace can change the rhythm of a day. This concept brings together an oak desk, a ceramic cup and a leafy plant beside a sunlit window. Keep the materials natural and the atmosphere warm.</w:t></w:r></w:p>
      {}<w:p><w:r><w:rPr><w:i/><w:color w:val="89967A"/><w:sz w:val="18"/></w:rPr><w:t>Figure 1. The starting concept — an intentionally simple mockup.</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t>Materials with a softer touch</w:t></w:r></w:p>
      <w:p><w:r><w:t>The final photograph should preserve the position of the desk, window and plant. Natural daylight and visible wood grain help the space feel tangible.</w:t></w:r></w:p>
      <w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:bottom w:val="single" w:sz="4" w:color="D8DFCD"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Material</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Natural oak and ceramic</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Reference detail</w:t></w:r></w:p>{}
      <w:p><w:r><w:t>This second placement deliberately uses the same embedded image. Replacing the first placement must leave this one unchanged.</w:t></w:r></w:p>
      <w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1100" w:right="1200" w:bottom="1100" w:left="1200" w:header="400" w:footer="400"/></w:sectPr>
      </w:body></w:document>"#,
        drawing(1, 5_943_600, 3_714_750),
        drawing(2, 3_200_000, 2_000_000)
    );
    let header = format!(
        r#"<w:hdr {namespaces}>{}</w:hdr>"#,
        drawing(3, 400_000, 250_000)
    );
    let rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships";
    let office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    archive(&[
        ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>"#.to_vec()),
        ("_rels/.rels", format!(r#"<Relationships xmlns="{rel_ns}"><Relationship Id="rId1" Type="{office}/officeDocument" Target="word/document.xml"/></Relationships>"#).into_bytes()),
        ("word/document.xml", body.into_bytes()),
        ("word/_rels/document.xml.rels", format!(r#"<Relationships xmlns="{rel_ns}"><Relationship Id="rIdImage" Type="{office}/image" Target="media/mockup.png"/><Relationship Id="rIdHeader" Type="{office}/header" Target="header1.xml"/><Relationship Id="rIdExternal" Type="{office}/hyperlink" Target="https://example.invalid/private" TargetMode="External"/></Relationships>"#).into_bytes()),
        ("word/header1.xml", header.into_bytes()),
        ("word/_rels/header1.xml.rels", format!(r#"<Relationships xmlns="{rel_ns}"><Relationship Id="rIdImage" Type="{office}/image" Target="media/mockup.png"/></Relationships>"#).into_bytes()),
        ("word/media/mockup.png", picture(false)),
        ("customXml/item1.xml", b"<preserved>This custom part must remain untouched</preserved>".to_vec()),
    ])
}
