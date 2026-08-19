mod comments;
mod compare;
mod items;
mod lens;
mod strip;
mod textual;
use crate::comments::*;
use crate::compare::*;
use crate::items::*;
use crate::strip::*;

use std::env;
use std::error::Error;
use std::fs;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("convert") if args.len() >= 4 => convert_dir(&args[2], &args[3]),
        Some("compare") if args.len() >= 4 => {
            let sibs: Vec<String> = args.get(4).map(|s| s.split(',').map(String::from).collect()).unwrap_or_default();
            compare_files(&args[2], &args[3], &sibs)
        }
        Some("strip") if args.len() >= 4 => strip_dir(&args[2], &args[3]),
        Some("restore") if args.len() >= 4 => restore_dir(&args[2], &args[3]),
        Some("roundtrip") if args.len() >= 4 => roundtrip_dir(&args[2], &args[3]),
        Some("owners") if args.len() >= 3 => lens::owners_cmd(&args[2]),
        Some("show") if args.len() >= 4 => {
            lens::show_cmd(&args[2], &args[3], args.iter().any(|a| a == "--notes"))
        }
        Some("notes") if args.len() >= 4 => lens::notes_cmd(&args[2], &args[3]),
        _ => Err("usage: tatamu strip <src-dir> <out-dir> | restore <stripped-dir> <out-dir> | roundtrip <src-dir> <work-dir> | owners <dir|file> | show <dir|file> <owner> [--notes] | notes <dir|file> <owner> | convert <src-dir> <out-dir> | compare <a.rs> <b.rs> [sibling,mods]".into()),
    }
}
fn convert_dir(src_dir: &str, out_dir: &str) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(out_dir)?;
    let mut names = Vec::new();
    for entry in fs::read_dir(src_dir)? {
        let p = entry?.path();
        if p.extension().map(|e| e == "rs").unwrap_or(false) {
            names.push(p.file_stem().unwrap().to_string_lossy().to_string());
        }
    }
    for name in &names {
        let siblings: Vec<String> = names
            .iter()
            .filter(|n| *n != name && *n != "main")
            .cloned()
            .collect();
        let src = fs::read_to_string(format!("{src_dir}/{name}.rs"))?;
        let converted = convert_file(&src, name, &siblings)?;
        fs::write(format!("{out_dir}/{name}.ttm"), converted.0)?;
        if !converted.1.is_empty() {
            fs::write(format!("{out_dir}/{name}.doc.md"), converted.1)?;
        }
        eprintln!("wrote {name}.ttm");
    }
    Ok(())
}
fn convert_file(
    src: &str,
    mod_name: &str,
    siblings: &[String],
) -> Result<(String, String), Box<dyn Error>> {
    let file = syn::parse_file(src)?;
    let mut out = Converted {
        ttm: Vec::new(),
        doc_intro: doc_lines(&file.attrs),
        doc_items: Vec::new(),
        uses_kept: Vec::new(),
    };
    convert_items(&file.items, siblings, &mut out);
    let ledger = extract_ledger(src, siblings);
    let mut ttm = String::new();
    for u in &out.uses_kept {
        ttm.push_str(u);
        ttm.push('\n');
    }
    for l in &out.ttm {
        ttm.push_str(l);
        ttm.push('\n');
    }
    let doc = render_sidecar(mod_name, &out, &ledger);
    Ok((ttm, doc))
}
fn render_sidecar(mod_name: &str, out: &Converted, ledger: &[LedgerEntry]) -> String {
    let mut items: Vec<String> = out.doc_items.iter().map(|(n, _)| n.clone()).collect();
    for e in ledger {
        if !items.iter().any(|n| *n == e.owner) {
            items.push(e.owner.clone())
        }
    }
    if out.doc_intro.is_empty() && items.is_empty() {
        return String::new();
    }
    let mut doc = format!("# {mod_name}\n");
    for l in &out.doc_intro {
        doc.push('\n');
        doc.push_str(l);
    }
    if !out.doc_intro.is_empty() {
        doc.push('\n')
    }
    for name in &items {
        doc.push_str(&format!("\n## {name}\n\n"));
        if let Some((_, body)) = out.doc_items.iter().find(|(n, _)| n == name) {
            for l in body {
                doc.push_str(l);
                doc.push('\n');
            }
        }
        let entries: Vec<&LedgerEntry> = ledger.iter().filter(|e| e.owner == *name).collect();
        if !entries.is_empty() {
            if out.doc_items.iter().any(|(n, _)| n == name) {
                doc.push('\n')
            }
            for e in entries {
                let suffix = if e.nth > 1 {
                    format!("#{}", e.nth)
                } else {
                    String::new()
                };
                doc.push_str(&format!(
                    "~ {} `{}`{}: {}\n",
                    e.kind, e.anchor, suffix, e.text
                ));
            }
        }
    }
    doc
}
