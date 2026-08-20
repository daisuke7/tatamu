//! Integration gate: `tatamu roundtrip` must be a byte-exact identity on the
//! test fixtures (which pack every hardened failure class from docs/36-38 and
//! the doc-form preservation work) and on this crate's own sources.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

static SEQ: AtomicUsize = AtomicUsize::new(0);

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_tatamu")
}

fn work_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "tatamu-it-{}-{}-{}",
        tag,
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = fs::remove_dir_all(&d);
    d
}

fn rs_files(dir: &Path, prefix: &str, out: &mut Vec<String>) {
    for e in fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        let name = p.file_name().unwrap().to_string_lossy().to_string();
        if p.is_dir() {
            rs_files(&p, &format!("{prefix}{name}/"), out);
        } else if name.ends_with(".rs") {
            out.push(format!("{prefix}{name}"));
        }
    }
}

/// Run `tatamu roundtrip src work`; assert the fixpoint gate (exit status)
/// and byte-exact restoration of every file.
fn assert_roundtrip_identity(src: &Path, tag: &str) {
    let work = work_dir(tag);
    let st = Command::new(bin())
        .args(["roundtrip", src.to_str().unwrap(), work.to_str().unwrap()])
        .output()
        .expect("failed to launch tatamu");
    assert!(
        st.status.success(),
        "fixpoint gate failed for {src:?}:\n{}{}",
        String::from_utf8_lossy(&st.stdout),
        String::from_utf8_lossy(&st.stderr)
    );
    let mut files = Vec::new();
    rs_files(src, "", &mut files);
    assert!(!files.is_empty(), "no .rs files under {src:?}");
    for f in files {
        let orig = fs::read_to_string(src.join(&f)).unwrap();
        let restored = fs::read_to_string(work.join("restored").join(&f))
            .unwrap_or_else(|_| panic!("restored file missing: {f}"));
        assert_eq!(orig, restored, "byte-exact restore failed for {f}");
    }
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn fixtures_roundtrip_byte_exact() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    assert_roundtrip_identity(&fixtures, "fixtures");
}

#[test]
fn self_roundtrip_byte_exact() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    assert_roundtrip_identity(&src, "self");
}

#[test]
fn lens_notes_finds_module_and_item_docs() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let work = work_dir("lens");
    let st = Command::new(bin())
        .args(["strip", fixtures.to_str().unwrap(), work.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(st.status.success(), "strip failed");
    // module docs via the file-stem pseudo-section
    let notes = Command::new(bin())
        .args(["notes", work.to_str().unwrap(), "hard"])
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&notes.stdout).to_string();
    assert!(notes.status.success() && text.contains("Module docs in block form"));
    // item docs with a cfg-twin shadow: both sections must answer a bare query
    let twin = Command::new(bin())
        .args(["notes", work.to_str().unwrap(), "twin"])
        .output()
        .unwrap();
    let ttext = String::from_utf8_lossy(&twin.stdout).to_string();
    assert!(ttext.contains("Twin under std") && ttext.contains("Twin without std"));
    let _ = fs::remove_dir_all(&work);
}
