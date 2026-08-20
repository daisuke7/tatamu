//! On-demand access to a codebase whose comments live in sidecar ledgers.
//!
//! `strip` makes the code cheap to hold in context; this module is the other
//! half of the bargain: when an agent (or human) needs the "why" back, it can
//! ask for exactly one item instead of re-reading whole files.
//!
//! Subcommands:
//! * `owners <dir|file>` — list every resolvable owner with its line range
//! * `show <dir|file> <owner> [--notes]` — print one item's source (optionally
//!   with its sidecar notes appended)
//! * `notes <dir|file> <owner>` — print just the sidecar section for an owner

use crate::strip::{code_lines_of, join_raw, owner_walk, parse_strip_sidecar, rs_names};
use crate::textual::{count_of, strip_lits};
use std::error::Error;
use std::fs;

type R<T> = Result<T, Box<dyn Error>>;

/// One resolved item: owner path plus the physical line range that contains it
/// (1-based, inclusive, attrs and doc comments directly above included).
struct ItemSpan {
    owner: String,
    start: usize,
    end: usize,
}

/// Files to operate on: a bare `.rs` path is taken as-is, a directory is
/// scanned for `.rs` files (same set the strip pipeline uses).
fn target_files(path: &str) -> R<Vec<String>> {
    let meta = fs::metadata(path)?;
    if meta.is_file() {
        return Ok(vec![path.to_string()]);
    }
    Ok(rs_names(path)?
        .into_iter()
        .map(|n| format!("{path}/{n}.rs"))
        .collect())
}

/// Resolve every owner in one file to its line span.
///
/// The walk mirrors the strip/restore pipeline exactly (same joining, same
/// scope stack), so a span found here is the same region a ledger anchor
/// refers to. The end of a brace-opening item is found by tracking net brace
/// depth until it returns to the opening level.
fn item_spans(src: &str) -> Vec<ItemSpan> {
    let lines: Vec<&str> = src.lines().collect();
    let (slines, phys) = code_lines_of(src);
    let joined = join_raw(&slines);
    let owners = owner_walk(&joined);
    let mut spans = Vec::new();
    for (k, j) in joined.iter().enumerate() {
        let (owner, resolved) = &owners[k];
        if !resolved {
            continue;
        }
        let bare = strip_lits(j.text.trim());
        let net = count_of(&bare, &['{']) as i64 - count_of(&bare, &['}']) as i64;
        let mut end = j.hi;
        // A signature wrapped rustfmt-style ends without its `{`; the block
        // then starts on the next logical line, so begin scanning there.
        let block_follows = net == 0
            && joined
                .get(k + 1)
                .map(|n| n.text.trim_start().starts_with('{'))
                .unwrap_or(false);
        if net > 0 || block_follows {
            let mut depth = net;
            for j2 in joined.iter().skip(k + 1) {
                let b2 = strip_lits(j2.text.trim());
                depth += count_of(&b2, &['{']) as i64 - count_of(&b2, &['}']) as i64;
                end = j2.hi;
                if depth <= 0 {
                    break;
                }
            }
        }
        // pull in attrs, docs, and comments sitting directly above the item;
        // multi-line attributes are skipped as whole joined lines first
        let mut kk = k;
        while kk > 0 && joined[kk - 1].text.trim_start().starts_with("#[") {
            kk -= 1;
        }
        let mut start = phys[joined[kk].lo];
        while start > 0 {
            let prev = lines[start - 1].trim();
            if prev.starts_with("#[") || prev.starts_with("//") {
                start -= 1;
            } else {
                break;
            }
        }
        spans.push(ItemSpan {
            owner: owner.clone(),
            start: start + 1,
            end: phys[end] + 1,
        });
    }
    spans
}

/// Sidecar sections for a source file, if its `.doc.md` exists. The module
/// docs (`//!` intro) are exposed as a pseudo-section named after the file
/// stem, so `notes race` can fetch them like any item.
fn sidecar_sections(file: &str) -> Vec<crate::strip::Section> {
    let sc_path = file.strip_suffix(".rs").map(|b| format!("{b}.doc.md"));
    let Some(sc_path) = sc_path else {
        return Vec::new();
    };
    match fs::read_to_string(&sc_path) {
        Ok(s) => {
            let (intro, _, mut sections) = parse_strip_sidecar(&s);
            if !intro.is_empty() {
                let stem = std::path::Path::new(file)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                sections.insert(
                    0,
                    crate::strip::Section {
                        owner: stem,
                        docs: intro,
                        notes: Vec::new(),
                    },
                );
            }
            sections
        }
        Err(_) => Vec::new(),
    }
}

fn print_section(sec: &crate::strip::Section) {
    println!("## {}", sec.owner);
    for d in &sec.docs {
        println!("{d}");
    }
    for (kind, anchor, nth, text) in &sec.notes {
        let ord = if *nth > 1 {
            format!("#{nth}")
        } else {
            String::new()
        };
        println!("~ {kind} `{anchor}`{ord}: {text}");
    }
}

/// `owners`: one line per item — `file:start-end owner`.
pub fn owners_cmd(path: &str) -> R<()> {
    for file in target_files(path)? {
        let src = fs::read_to_string(&file)?;
        for sp in item_spans(&src) {
            println!("{file}:{}-{} {}", sp.start, sp.end, sp.owner);
        }
    }
    Ok(())
}

/// Owner match rule shared by `show` and `notes`: exact path first, then a
/// `::`-suffix match so `get` finds `OnceCell::get` when unambiguous.
/// Sidecar sections may carry an `#n` shadow (cfg twins); a bare query
/// matches every occurrence, while `name#2` pins one.
fn owner_matches(candidate: &str, query: &str) -> bool {
    if candidate == query {
        return true;
    }
    let (base, _) = crate::strip::split_owner_shadow(candidate);
    base == query || base.ends_with(&format!("::{query}"))
}

/// `show`: print the source of every item matching `owner`.
pub fn show_cmd(path: &str, owner: &str, with_notes: bool) -> R<()> {
    let mut found = false;
    for file in target_files(path)? {
        let src = fs::read_to_string(&file)?;
        let lines: Vec<&str> = src.lines().collect();
        for sp in item_spans(&src) {
            if !owner_matches(&sp.owner, owner) {
                continue;
            }
            found = true;
            println!("// {file}:{}-{} {}", sp.start, sp.end, sp.owner);
            for l in &lines[sp.start - 1..sp.end] {
                println!("{l}");
            }
            if with_notes {
                for sec in sidecar_sections(&file) {
                    if owner_matches(&sec.owner, owner) {
                        println!();
                        print_section(&sec);
                    }
                }
            }
        }
    }
    if !found {
        return Err(format!("no item matching `{owner}` under {path}").into());
    }
    Ok(())
}

/// `notes`: print the sidecar sections matching `owner`.
pub fn notes_cmd(path: &str, owner: &str) -> R<()> {
    let mut found = false;
    for file in target_files(path)? {
        for sec in sidecar_sections(&file) {
            if owner_matches(&sec.owner, owner) {
                found = true;
                println!("// {file}");
                print_section(&sec);
                println!();
            }
        }
    }
    if !found {
        return Err(format!("no sidecar notes for `{owner}` under {path}").into());
    }
    Ok(())
}
