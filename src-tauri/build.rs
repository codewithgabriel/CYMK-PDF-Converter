fn main() {
    #[cfg(feature = "private-key")]
    {
        println!("cargo:rerun-if-env-changed=INKWELL_PRIVATE_API_KEY");
        let key = std::env::var("INKWELL_PRIVATE_API_KEY")
            .expect("Private builds require INKWELL_PRIVATE_API_KEY from a secure build secret.");
        assert!(
            key.len() >= 20 && key.len() <= 512 && !key.chars().any(char::is_whitespace),
            "Private build API key is missing or invalid."
        );
    }
    #[cfg(feature = "desktop")]
    tauri_build::build()
}
