#[test]
fn private_build_reports_ready_without_exposing_the_included_key() {
    let studio = inkwell::studio::Studio::from_environment();
    let status = studio.status().unwrap();
    assert_eq!(status.key_included, cfg!(feature = "private-key"));
    #[cfg(feature = "private-key")]
    {
        assert!(status.configured);
        let serialized = serde_json::to_string(&status).unwrap();
        assert!(!serialized.contains(env!("INKWELL_PRIVATE_API_KEY")));
    }
}
