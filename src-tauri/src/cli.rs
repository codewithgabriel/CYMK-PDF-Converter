fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        eprintln!("Usage: inkwell-convert INPUT OUTPUT DENSITY DPI");
        std::process::exit(2);
    }
    let density = args[3].parse().unwrap_or(255);
    let dpi = args[4].parse().unwrap_or(0);
    let gs = std::env::var("INKWELL_GS").unwrap_or("gs".into());
    match inkwell::convert(
        args[1].as_ref(),
        args[2].as_ref(),
        density,
        dpi,
        gs.as_ref(),
    ) {
        Ok(result) => println!(
            "Saved {} pages ({} bytes) to {}",
            result.pages, result.bytes, result.path
        ),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
