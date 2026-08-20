use crate::comments::*;
use crate::compare::*;
use crate::textual::*;

use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::sync::OnceLock;

/// A standalone comment waiting for the code line it sits above.
pub(crate) struct AboveNote {
    pub text: String,
    /// a blank line separated the comment from its anchor
    pub detached: bool,
    /// indent column of the comment's own line
    pub indent: usize,
    /// captured before any doc lines of the same anchor
    pub pre_docs: bool,
    /// captured before the module intro and any code (file preamble)
    pub pre_intro: bool,
    /// a kept-verbatim comment block was emitted after this note, so later
    /// blank lines no longer describe its detachment
    pub sealed: bool,
}
pub(crate) struct SLine {
    pub code: String,
    pub above: Vec<AboveNote>,
    /// (text, spaces between code end and `//` — alignment padding)
    pub tail: Option<(String, usize)>,
    pub docs: Vec<String>,
}
struct Stripped {
    pub text: String,
    pub slines: Vec<SLine>,
    pub intro: Vec<String>,
    /// true when the module docs came from a clean standalone `/*! ... */`
    /// block, so restore can reproduce that form byte-exactly
    pub intro_block: bool,
}
pub(crate) struct JoinedRaw {
    pub text: String,
    pub lo: usize,
    pub hi: usize,
}
/// Returns (code, comment, safety-comment, gap) where gap counts the spaces
/// between the end of the code and the `//` (alignment padding).
fn cut_line_comment(
    line: &str,
    keep_safety: bool,
) -> (String, Option<String>, Option<String>, usize) {
    match find_line_comment(line) {
        None => (line.to_string(), None, None, 0),
        Some(sl) => {
            let raw = line[sl + 2..].trim_end();
            let text = match raw.strip_prefix(' ') {
                Some(r) if !r.starts_with(' ') && !r.starts_with('/') => r.to_string(),
                _ => raw.to_string(),
            };
            let before = line[..sl].to_string();
            let gap = sl - before.trim_end().len();
            if keep_safety && text.starts_with("SAFETY") {
                return (before.trim_end().to_string(), None, Some(text), gap);
            }
            (before.trim_end().to_string(), Some(text), None, gap)
        }
    }
}
fn indent_col(l: &str) -> usize {
    l.len() - l.trim_start().len()
}
fn strip_source(src: &str) -> Stripped {
    let mut out: Vec<String> = Vec::new();
    let mut slines: Vec<SLine> = Vec::new();
    let mut pending_above: Vec<AboveNote> = Vec::new();
    let mut pending_docs: Vec<String> = Vec::new();
    let mut intro: Vec<String> = Vec::new();
    let mut intro_block = false;
    let mut in_block = false;
    let mut keep_block = false;
    let mut str_open = false;
    let mut safety_cont = false;
    let mut block_mode = 0i64;
    let mut mac_depth = 0i64;
    for raw_line in src.lines() {
        let mut line = raw_line.to_string();
        if str_open {
            out.push(line.clone());
            crate::textual::bare_update(&line, &mut str_open);
            slines.push(SLine {
                code: line.trim_end().to_string(),
                above: std::mem::take(&mut pending_above),
                tail: None,
                docs: std::mem::take(&mut pending_docs),
            });
            continue;
        }
        if mac_depth > 0 {
            out.push(line.trim_end().to_string());
            let (cv, _, _, _) = cut_line_comment(&line, false);
            let bare = strip_lits(&cv);
            mac_depth +=
                count_of(&bare, &['{', '(', '[']) as i64 - count_of(&bare, &['}', ')', ']']) as i64;
            if !cv.trim().is_empty() {
                crate::textual::bare_update(&cv, &mut str_open);
                slines.push(SLine {
                    code: cv.trim_end().to_string(),
                    above: std::mem::take(&mut pending_above),
                    tail: None,
                    docs: std::mem::take(&mut pending_docs),
                });
            }
            continue;
        }
        let mut changed = false;
        if in_block {
            if keep_block {
                out.push(line.clone());
                if line.contains("*/") {
                    in_block = false;
                    keep_block = false;
                }
                continue;
            }
            match line.find("*/") {
                Some(e) => {
                    let clean_close =
                        line[..e].trim().is_empty() && line[e + 2..].trim().is_empty();
                    if block_mode == 1 && intro_block && clean_close {
                        // standalone `*/` closing a clean module-doc block
                    } else {
                        if block_mode == 1 && intro_block {
                            intro_block = false;
                        }
                        let t = line[..e].trim().to_string();
                        push_block_text(
                            t,
                            block_mode,
                            indent_col(&line),
                            &mut pending_above,
                            &mut pending_docs,
                            &mut intro,
                        );
                    }
                    line = line[e + 2..].to_string();
                    in_block = false;
                    block_mode = 0;
                    changed = true;
                }
                None => {
                    if block_mode == 1 && intro_block {
                        // inside a clean `/*!` block: keep the line verbatim
                        intro.push(line.clone());
                    } else {
                        let t = line.trim().to_string();
                        push_block_text(
                            t,
                            block_mode,
                            indent_col(&line),
                            &mut pending_above,
                            &mut pending_docs,
                            &mut intro,
                        );
                    }
                    continue;
                }
            }
        }
        let mut keep_whole = false;
        loop {
            let s = match line.find("/*") {
                Some(s) if blank_strings(&line).as_bytes().get(s) == Some(&b'/') => s,
                _ => break,
            };
            // A `/*` after a line-comment start is text, not a block opener
            // (doc lines cite URLs like `docs.rs/linked-hash-map/*/...`).
            if blank_strings(&line)[..s].contains("//") {
                break;
            }
            let standalone = line[..s].trim().is_empty();
            let after = &line[s + 2..];
            let mode = if after.starts_with('!') {
                1i64
            } else if after.starts_with('*') && !after.starts_with("*/") {
                2i64
            } else {
                0i64
            };
            let mstrip = if mode > 0 { 1 } else { 0 };
            match line[s + 2 + mstrip..].find("*/") {
                Some(rel) => {
                    // Plain (non-doc) block comments stay verbatim: a
                    // standalone one keeps its whole line, an inline one
                    // stays embedded in the code line. Only doc blocks
                    // (`/*!`, `/**`) are externalized.
                    if mode == 0 {
                        if standalone {
                            keep_whole = true;
                        }
                        break;
                    }
                    let txt = line[s + 2 + mstrip..s + 2 + mstrip + rel]
                        .trim()
                        .to_string();
                    push_block_text(
                        txt,
                        mode,
                        indent_col(&line),
                        &mut pending_above,
                        &mut pending_docs,
                        &mut intro,
                    );
                    line = format!("{}{}", &line[..s], &line[s + 4 + mstrip + rel..]);
                    changed = true;
                }
                None => {
                    let txt = line[s + 2 + mstrip..].trim().to_string();
                    if standalone && mode == 0 {
                        // multi-line plain block comment: keep it whole
                        out.push(line.clone());
                        in_block = true;
                        keep_block = true;
                        keep_whole = true;
                        break;
                    }
                    if mode == 1 && standalone && txt.is_empty() && intro.is_empty() {
                        // clean `/*!` opener on its own line: remember the
                        // block form instead of pushing an empty intro line
                        intro_block = true;
                    } else {
                        if mode == 1 {
                            intro_block = false;
                        }
                        push_block_text(
                            txt,
                            mode,
                            indent_col(&line),
                            &mut pending_above,
                            &mut pending_docs,
                            &mut intro,
                        );
                    }
                    line = line[..s].to_string();
                    in_block = true;
                    block_mode = mode;
                    changed = true;
                    break;
                }
            }
        }
        if keep_whole {
            if !keep_block {
                out.push(line.clone())
            }
            // a verbatim comment block now separates the pending notes from
            // their anchor; later blanks say nothing about their detachment
            for n in pending_above.iter_mut() {
                n.sealed = true
            }
            continue;
        }
        let t = line.trim();
        if safety_cont && t.starts_with("//") && !t.starts_with("///") {
            out.push(line.trim_end().to_string());
            continue;
        }
        safety_cont = false;
        if t.starts_with("//!") {
            // mixing `//!` lines with a `/*!` block falls back to line form
            intro_block = false;
            intro.push(t[3..].strip_prefix(" ").unwrap_or(&t[3..]).to_string());
            continue;
        }
        if t.starts_with("///") && !t.starts_with("////") {
            pending_docs.push(t[3..].strip_prefix(" ").unwrap_or(&t[3..]).to_string());
            continue;
        }
        let (code, above, safety_tail, gap) = cut_line_comment(&line, true);
        let mut tail = None;
        if let Some(a) = above {
            if code.trim().is_empty() {
                pending_above.push(AboveNote {
                    text: a,
                    detached: false,
                    indent: indent_col(&line),
                    pre_docs: pending_docs.is_empty(),
                    pre_intro: intro.is_empty() && !intro_block && slines.is_empty(),
                    sealed: false,
                });
                changed = true;
            } else {
                tail = Some((a, gap));
                changed = true;
            }
        }
        let emit = if safety_tail.is_some() {
            line.trim_end().to_string()
        } else {
            code.clone()
        };
        if code.trim().is_empty() {
            if !changed && safety_tail.is_none() {
                if line.trim().is_empty() {
                    for n in pending_above.iter_mut() {
                        if !n.sealed {
                            n.detached = true
                        }
                    }
                }
                out.push(line.trim_end().to_string());
            } else if safety_tail.is_some() {
                out.push(emit);
                safety_cont = true;
                for n in pending_above.iter_mut() {
                    n.sealed = true
                }
            }
            continue;
        }
        out.push(emit);
        crate::textual::bare_update(&code, &mut str_open);
        slines.push(SLine {
            code: code.trim_end().to_string(),
            above: std::mem::take(&mut pending_above),
            tail,
            docs: std::mem::take(&mut pending_docs),
        });
        let d = crate::textual::macro_open_depth(&strip_lits(&code));
        if d > 0 {
            mac_depth = d
        }
    }
    // comments at the very end of the file have no code line to anchor to:
    // keep them inline rather than losing them
    for n in &pending_above {
        out.push(format!(
            "{}//{}",
            " ".repeat(n.indent),
            comment_body(&n.text)
        ));
    }
    for d in &pending_docs {
        out.push(if d.is_empty() {
            "///".to_string()
        } else {
            format!("/// {d}")
        });
    }
    Stripped {
        text: format!("{}\n", out.join("\n")),
        slines,
        intro,
        intro_block,
    }
}
pub(crate) fn join_raw(slines: &[SLine]) -> Vec<JoinedRaw> {
    let mut joined: Vec<JoinedRaw> = Vec::new();
    let mut buf: Option<JoinedRaw> = None;
    for (i, r) in slines.iter().enumerate() {
        let t = r.code.trim();
        match buf.as_mut() {
            None => {
                buf = Some(JoinedRaw {
                    text: t.to_string(),
                    lo: i,
                    hi: i,
                })
            }
            Some(b) => {
                let glue = if b.text.ends_with('(')
                    || t.starts_with(')')
                    || t.starts_with('.')
                    || t.starts_with(']')
                {
                    ""
                } else {
                    " "
                };
                b.text.push_str(glue);
                b.text.push_str(t);
                b.hi = i;
            }
        }
        let b = buf.as_ref().unwrap();
        let bare = strip_lits(&b.text);
        let depth = count_of(&bare, &['(', '[']) as i64 - count_of(&bare, &[')', ']']) as i64;
        let next = slines.get(i + 1).map(|r| r.code.trim()).unwrap_or("");
        let terminated = ends_terminated(&bare) || next.starts_with('}') || next.is_empty();
        if depth <= 0 && terminated {
            joined.push(buf.take().unwrap());
        }
    }
    if let Some(b) = buf {
        joined.push(b)
    }
    joined
}
fn qualify_owner(stack: &[(String, i64, i64)], name: String) -> String {
    match stack.last() {
        Some((p, _, _)) => format!("{p}::{name}"),
        None => name,
    }
}
fn scope_mod_name(t: &str) -> Option<String> {
    static RE_MOD: OnceLock<regex::Regex> = OnceLock::new();
    crate::textual::re(
        r"^(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?mod\s+(\w+)",
        &RE_MOD,
    )
    .captures(t)
    .map(|c| c[1].to_string())
}
fn use_name(t: &str) -> Option<String> {
    static RE_USE: OnceLock<regex::Regex> = OnceLock::new();
    let cap = crate::textual::re(
        r"^(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)",
        &RE_USE,
    )
    .captures(t)?;
    let path = cap[1].trim_end_matches(':').to_string();
    if path.is_empty() {
        return None;
    }
    Some(format!("use {}", path.rsplit("::").next().unwrap_or(&path)))
}
fn scope_is_trait(t: &str) -> bool {
    static RE_TRAIT: OnceLock<regex::Regex> = OnceLock::new();
    crate::textual::re(
        r"^(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+\w+",
        &RE_TRAIT,
    )
    .is_match(t)
}
fn scope_is_enum(t: &str) -> bool {
    static RE_ENUM: OnceLock<regex::Regex> = OnceLock::new();
    crate::textual::re(
        r"^(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?enum\s+\w+",
        &RE_ENUM,
    )
    .is_match(t)
}
fn scope_is_struct(t: &str) -> bool {
    static RE_STRUCT: OnceLock<regex::Regex> = OnceLock::new();
    crate::textual::re(
        r"^(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:struct|union)\s+\w+",
        &RE_STRUCT,
    )
    .is_match(t)
}
fn variant_name(t: &str) -> Option<String> {
    static RE_VAR: OnceLock<regex::Regex> = OnceLock::new();
    crate::textual::re(r"^(?:#\[[^\]]*\]\s*)*([A-Za-z_]\w*)", &RE_VAR)
        .captures(t)
        .map(|c| c[1].to_string())
}
fn field_name(t: &str) -> Option<String> {
    static RE_FIELD: OnceLock<regex::Regex> = OnceLock::new();
    crate::textual::re(
        r"^(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?r?#?(\w+)\s*:",
        &RE_FIELD,
    )
    .captures(t)
    .map(|c| c[1].to_string())
}
pub(crate) fn owner_walk(joined: &[JoinedRaw]) -> Vec<(String, bool)> {
    let mut owners = Vec::new();
    let mut owner = String::new();
    let mut stack: Vec<(String, i64, i64)> = Vec::new();
    let mut depth0 = 0i64;
    // A scope-forming decl whose `{` sits on the NEXT logical line (rustfmt
    // wraps long where clauses that way) parks its label here; the brace line
    // completes the push.
    let mut pending_scope: Option<(String, i64)> = None;
    for j in joined {
        let t = j.text.trim();
        if let Some((label, kind)) = pending_scope.take() {
            if t.starts_with('{') {
                stack.push((label, depth0, kind));
            } else {
                let b = strip_lits(t);
                // still inside the wrapped where clause (further bounds)
                if !b.contains('{') && !b.contains('}') && !b.contains(';') {
                    pending_scope = Some((label, kind));
                }
            }
        }
        let mut resolved = false;
        let scope_depth = stack.last().map(|s| s.1 + 1).unwrap_or(0);
        let top_kind = stack.last().map(|s| s.2).unwrap_or(0);
        let bare = strip_lits(t);
        let net = count_of(&bare, &['{']) as i64 - count_of(&bare, &['}']) as i64;
        if depth0 == scope_depth && top_kind == 2 {
            if let Some(v) = variant_name(t) {
                let label = qualify_owner(&stack, v);
                owner = label.clone();
                resolved = true;
                // a struct-like variant scopes its named fields
                if net > 0 {
                    stack.push((label, depth0, 3))
                }
            }
        } else if depth0 == scope_depth && top_kind == 3 {
            if let Some(f) = field_name(t) {
                owner = qualify_owner(&stack, f);
                resolved = true;
            }
        } else if depth0 == scope_depth {
            let head = t
                .trim_start()
                .strip_prefix("unsafe ")
                .unwrap_or(t.trim_start());
            if let Some(ty) = impl_target(head) {
                let label = qualify_owner(&stack, ty);
                owner = label.clone();
                resolved = true;
                if net > 0 {
                    stack.push((label, depth0, 1))
                } else if !bare.contains('{') {
                    pending_scope = Some((label, 1))
                }
            } else if let Some(m) = scope_mod_name(t) {
                let label = qualify_owner(&stack, m);
                owner = label.clone();
                resolved = true;
                if net > 0 {
                    stack.push((label, depth0, 0))
                } else if !bare.contains('{') && !bare.ends_with(';') {
                    pending_scope = Some((label, 0))
                }
            } else if let Some(name) = decl_name(t) {
                let label = qualify_owner(&stack, name);
                owner = label.clone();
                resolved = true;
                let kind = if scope_is_trait(t) {
                    Some(1)
                } else if scope_is_enum(t) {
                    Some(2)
                } else if scope_is_struct(t) {
                    Some(3)
                } else {
                    None
                };
                if let Some(kind) = kind {
                    if net > 0 {
                        stack.push((label, depth0, kind))
                    } else if !bare.contains('{') && !bare.ends_with(';') {
                        pending_scope = Some((label, kind))
                    }
                }
            } else if let Some(mac) = macro_rules_name(t) {
                owner = qualify_owner(&stack, mac);
                resolved = true;
            } else if let Some(u) = use_name(t) {
                owner = qualify_owner(&stack, u);
                resolved = true;
            }
        } else if depth0 > scope_depth && !owner.is_empty() {
            // an item declared inside a body (fn-local struct/enum/const):
            // label it under the sticky owner so its docs have a home
            if let Some(name) = decl_name(t).or_else(|| macro_rules_name(t)) {
                owner = format!("{owner}::{name}");
                resolved = true;
            }
        }
        owners.push((owner.clone(), resolved));
        depth0 += net;
        while let Some((_, od, _)) = stack.last() {
            if depth0 <= *od {
                stack.pop();
            } else {
                break;
            }
        }
    }
    owners
}
fn phys_keys(
    slines: &[SLine],
    joined: &[JoinedRaw],
    owners: &[(String, bool)],
) -> Vec<(String, String, usize)> {
    let mut shadows: HashMap<String, Vec<String>> = HashMap::new();
    let mut keys = vec![(String::new(), String::new(), 0usize); slines.len()];
    for (k, j) in joined.iter().enumerate() {
        for i in j.lo..=j.hi {
            let anchor = slines[i].code.trim().to_string();
            let owner = owners[k].0.clone();
            let shadow = shadows.entry(owner.clone()).or_default();
            shadow.push(anchor.clone());
            let nth = shadow.iter().filter(|l| **l == anchor).count();
            keys[i] = (owner, anchor, nth);
        }
    }
    keys
}
fn collect_strip(
    slines: &[SLine],
    has_intro: bool,
) -> (Vec<LedgerEntry>, Vec<(String, Vec<String>)>) {
    let joined = join_raw(slines);
    let owners = owner_walk(&joined);
    let keys = phys_keys(slines, &joined, &owners);
    let mut entries = Vec::new();
    let mut docs: Vec<(String, Vec<String>)> = Vec::new();
    let mut doc_pool: Vec<String> = Vec::new();
    // Items redeclared under a different cfg (std/no_std variants) share an
    // owner label; the n-th declaration gets an `#n` shadow so its docs can
    // find their way back to the right one.
    let mut decl_occ: HashMap<String, usize> = HashMap::new();
    for (k, j) in joined.iter().enumerate() {
        let (owner, resolved) = &owners[k];
        if *resolved {
            *decl_occ.entry(owner.clone()).or_default() += 1;
        }
        for i in j.lo..=j.hi {
            doc_pool.extend(slines[i].docs.iter().cloned());
        }
        if *resolved && !doc_pool.is_empty() {
            let n = decl_occ[owner];
            let name = if n > 1 {
                format!("{owner}#{n}")
            } else {
                owner.clone()
            };
            docs.push((name, std::mem::take(&mut doc_pool)));
        } else if !*resolved && !doc_pool.is_empty() && !t_is_attr(&j.text) {
            doc_pool.clear();
            eprintln!(
                "strip: dropping doc lines with no owner near `{}`",
                j.text.trim().chars().take(60).collect::<String>()
            );
        }
        for i in j.lo..=j.hi {
            let (o, anchor, nth) = &keys[i];
            let sec = if o.is_empty() {
                "(mod)".to_string()
            } else {
                o.clone()
            };
            for n in &slines[i].above {
                let base = if n.detached { "float" } else { "above" };
                // `^` marks a comment that sat before the item's doc block or
                // before the module docs, so restore keeps it above them.
                let pre_mark =
                    if (n.pre_docs && !slines[i].docs.is_empty()) || (n.pre_intro && has_intro) {
                        "^"
                    } else {
                        ""
                    };
                // A comment indented differently from its anchor carries the
                // difference as `above+4` / `above-2` so restore can put it
                // back at its own column, not the anchor's.
                let delta = n.indent as i64 - indent_col(&slines[i].code) as i64;
                let kind = if delta != 0 {
                    format!("{base}{pre_mark}{delta:+}")
                } else {
                    format!("{base}{pre_mark}")
                };
                entries.push(LedgerEntry {
                    owner: sec.clone(),
                    kind,
                    anchor: anchor.clone(),
                    nth: *nth,
                    text: n.text.clone(),
                });
            }
            if let Some((tl, gap)) = &slines[i].tail {
                // alignment padding beyond the single default space is kept
                // as a `tail+N` delta
                let delta = *gap as i64 - 1;
                let kind = if delta != 0 {
                    format!("tail{delta:+}")
                } else {
                    "tail".to_string()
                };
                entries.push(LedgerEntry {
                    owner: sec.clone(),
                    kind,
                    anchor: anchor.clone(),
                    nth: *nth,
                    text: tl.clone(),
                });
            }
        }
    }
    (entries, docs)
}
fn t_is_attr(t: &str) -> bool {
    t.trim_start().starts_with("#[")
}
fn esc(l: &str) -> String {
    if l.is_empty() {
        return "\\".to_string();
    }
    if l.starts_with('#') || l.starts_with('~') || l.starts_with('\\') {
        format!("\\{l}")
    } else {
        l.to_string()
    }
}
fn unesc(l: &str) -> String {
    if l.starts_with('\\') {
        l[1..].to_string()
    } else {
        l.to_string()
    }
}
fn render_strip_sidecar(
    mod_name: &str,
    intro: &[String],
    intro_block: bool,
    docs: &[(String, Vec<String>)],
    entries: &[LedgerEntry],
) -> String {
    if intro.is_empty() && docs.is_empty() && entries.is_empty() {
        return String::new();
    }
    let mut owners: Vec<String> = docs.iter().map(|(n, _)| n.clone()).collect();
    for e in entries {
        if !owners.iter().any(|n| *n == e.owner) {
            owners.push(e.owner.clone())
        }
    }
    let mut doc = format!("# {mod_name}\n");
    if intro_block {
        doc.push_str("\n~ form: block\n");
    }
    for l in intro {
        doc.push('\n');
        doc.push_str(&esc(l));
    }
    if !intro.is_empty() {
        doc.push('\n')
    }
    for name in &owners {
        doc.push_str(&format!("\n## {name}\n\n"));
        let mut had_docs = false;
        for (n, body) in docs {
            if n == name {
                for l in body {
                    doc.push_str(&esc(l));
                    doc.push('\n');
                }
                had_docs = true;
            }
        }
        let sec: Vec<&LedgerEntry> = entries.iter().filter(|e| e.owner == *name).collect();
        if !sec.is_empty() {
            if had_docs {
                doc.push('\n')
            }
            for e in sec {
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
pub(crate) struct Section {
    pub owner: String,
    pub docs: Vec<String>,
    pub notes: Vec<(String, String, usize, String)>,
}
fn parse_note(l: &str) -> Option<(String, String, usize, String)> {
    let rest = l.strip_prefix("~ ")?;
    let sp = rest.find(' ')?;
    let kind = rest[..sp].to_string();
    let rem = rest[sp + 1..].strip_prefix('`')?;
    // The anchor ends at the first `` ` `` followed by `:` or `#n:`. Scanning
    // from the left matters: the comment text is prose and may well contain
    // `` `: `` itself (inline code like `` `:elorw` ``), while a backtick
    // inside the anchor (a code line) is far rarer.
    for (h, _) in rem.match_indices('`') {
        let after = &rem[h + 1..];
        if let Some(text) = after.strip_prefix(':') {
            let text = text.strip_prefix(' ').unwrap_or(text).to_string();
            return Some((kind, rem[..h].to_string(), 1, text));
        }
        if let Some(shadow) = after.strip_prefix('#') {
            if let Some(c) = shadow.find(':') {
                if c > 0 && shadow[..c].chars().all(|ch| ch.is_ascii_digit()) {
                    let nth: usize = shadow[..c].parse().ok()?;
                    let text = shadow[c + 1..]
                        .strip_prefix(' ')
                        .unwrap_or(&shadow[c + 1..])
                        .to_string();
                    return Some((kind, rem[..h].to_string(), nth, text));
                }
            }
        }
    }
    None
}
pub(crate) fn parse_strip_sidecar(s: &str) -> (Vec<String>, bool, Vec<Section>) {
    let mut intro = Vec::new();
    let mut intro_block = false;
    let mut sections: Vec<Section> = Vec::new();
    let mut in_intro = true;
    for (i, l) in s.lines().enumerate() {
        if i == 0 && l.starts_with("# ") {
            continue;
        }
        if let Some(name) = l.strip_prefix("## ") {
            sections.push(Section {
                owner: name.trim().to_string(),
                docs: Vec::new(),
                notes: Vec::new(),
            });
            in_intro = false;
            continue;
        }
        if in_intro {
            if l == "~ form: block" && intro.is_empty() {
                intro_block = true;
            } else if !l.is_empty() {
                intro.push(unesc(l))
            }
            continue;
        }
        let sec = match sections.last_mut() {
            Some(s) => s,
            None => continue,
        };
        if l.starts_with("~ ") {
            if let Some(n) = parse_note(l) {
                sec.notes.push(n);
                continue;
            }
        }
        if !l.trim().is_empty() {
            sec.docs.push(unesc(l))
        }
    }
    (intro, intro_block, sections)
}
pub(crate) fn code_lines_of(stripped: &str) -> (Vec<SLine>, Vec<usize>) {
    let mut slines = Vec::new();
    let mut phys = Vec::new();
    let mut str_open = false;
    let mut in_safety_block = false;
    for (i, line) in stripped.lines().enumerate() {
        if str_open {
            let l = line.to_string();
            crate::textual::bare_update(&l, &mut str_open);
            slines.push(SLine {
                code: l.trim_end().to_string(),
                above: Vec::new(),
                tail: None,
                docs: Vec::new(),
            });
            phys.push(i);
            continue;
        }
        if in_safety_block {
            if line.contains("*/") {
                in_safety_block = false
            }
            continue;
        }
        let t = line.trim();
        if t.starts_with("/*") {
            if !line.contains("*/") {
                in_safety_block = true
            }
            continue;
        }
        let (code, _, _, _) = cut_line_comment(line, true);
        if code.trim().is_empty() {
            continue;
        }
        crate::textual::bare_update(&code, &mut str_open);
        slines.push(SLine {
            code: code.trim_end().to_string(),
            above: Vec::new(),
            tail: None,
            docs: Vec::new(),
        });
        phys.push(i);
    }
    (slines, phys)
}
fn indent_of(l: &str) -> String {
    l[..l.len() - l.trim_start().len()].to_string()
}
/// `above^+4` → ("above", pre-docs, +4); both suffixes are optional.
fn split_kind_delta(kind: &str) -> (&str, bool, i64) {
    let (head, delta) = match kind.find(['+', '-']) {
        Some(pos) => match kind[pos..].parse::<i64>() {
            Ok(d) => (&kind[..pos], d),
            Err(_) => (kind, 0),
        },
        None => (kind, 0),
    };
    match head.strip_suffix('^') {
        Some(base) => (base, true, delta),
        None => (head, false, delta),
    }
}
pub(crate) fn split_owner_shadow(owner: &str) -> (String, usize) {
    if let Some(pos) = owner.rfind('#') {
        if pos > 0
            && !owner[pos + 1..].is_empty()
            && owner[pos + 1..].bytes().all(|b| b.is_ascii_digit())
        {
            return (owner[..pos].to_string(), owner[pos + 1..].parse().unwrap());
        }
    }
    (owner.to_string(), 1)
}
fn restore_source(stripped: &str, sidecar: &str) -> String {
    let (intro, intro_block, sections) = parse_strip_sidecar(sidecar);
    let lines: Vec<String> = stripped.lines().map(String::from).collect();
    let (slines, phys) = code_lines_of(stripped);
    let joined = join_raw(&slines);
    let owners = owner_walk(&joined);
    let keys = phys_keys(&slines, &joined, &owners);
    // rank orders insertions sharing a line: preamble comments (0) go above
    // the doc block (1); ordinary comments (2) go below it.
    let mut by_line: HashMap<usize, Vec<(u8, String)>> = HashMap::new();
    let mut tails: Vec<(usize, String, i64)> = Vec::new();
    // which physical lines are comments (incl. whole kept `/* */` blocks), so
    // the placement walk skips a block as one unit instead of stopping — or
    // worse, landing — inside it
    let cmap: Vec<bool> = {
        let mut map = vec![false; lines.len()];
        let mut in_blk = false;
        for (i, l) in lines.iter().enumerate() {
            let t = l.trim();
            if in_blk {
                map[i] = true;
                if t.contains("*/") {
                    in_blk = false;
                }
            } else if t.starts_with("/*") {
                map[i] = true;
                if !t.contains("*/") {
                    in_blk = true;
                }
            } else if t.starts_with("//") {
                map[i] = true;
            }
        }
        map
    };
    for sec in &sections {
        // `owner#n` targets the n-th declaration sharing that label (cfg
        // std/no_std twins); a bare owner is occurrence 1.
        let (base_owner, occ) = split_owner_shadow(&sec.owner);
        let match_owner = if base_owner == "(mod)" {
            String::new()
        } else {
            base_owner.clone()
        };
        if !sec.docs.is_empty() {
            if let Some(k) = (0..joined.len())
                .filter(|k| owners[*k].1 && owners[*k].0 == match_owner)
                .nth(occ - 1)
            {
                // Docs go above the item's attributes; walk joined lines so a
                // multi-line `#[cfg_attr(...)]` is skipped as one unit.
                let mut kk = k;
                while kk > 0 && joined[kk - 1].text.trim_start().starts_with("#[") {
                    kk -= 1
                }
                let mut p = phys[joined[kk].lo];
                let ind = indent_of(&lines[phys[joined[k].lo]]);
                while p > 0 && lines[p - 1].trim().starts_with("#[") {
                    p -= 1
                }
                let slot = by_line.entry(p).or_default();
                for d in &sec.docs {
                    slot.push((
                        1,
                        if d.is_empty() {
                            format!("{ind}///")
                        } else {
                            format!("{ind}/// {d}")
                        },
                    ));
                }
            } else {
                eprintln!("restore: no target for docs of `{}`", sec.owner);
            }
        }
        for (kind, anchor, nth, text) in &sec.notes {
            let hit = (0..slines.len())
                .find(|i| keys[*i].0 == match_owner && keys[*i].1 == *anchor && keys[*i].2 == *nth);
            let i = match hit {
                Some(i) => i,
                None => {
                    eprintln!(
                        "restore: unresolved anchor `{}` (owner {})",
                        anchor, sec.owner
                    );
                    continue;
                }
            };
            let (kbase, pre, delta) = split_kind_delta(kind);
            let mut p = phys[i];
            if kbase == "tail" {
                tails.push((p, text.clone(), delta));
            } else {
                let ind = if delta == 0 {
                    indent_of(&lines[p])
                } else {
                    " ".repeat((indent_of(&lines[p]).len() as i64 + delta).max(0) as usize)
                };
                while p > 0 && cmap[p - 1] {
                    p -= 1
                }
                // cross a blank run only when more comment lines sit above it
                // (comment → kept block → blank → anchor layouts)
                loop {
                    let mut q = p;
                    while q > 0 && lines[q - 1].trim().is_empty() {
                        q -= 1
                    }
                    if q < p && q > 0 && cmap[q - 1] {
                        p = q;
                        while p > 0 && cmap[p - 1] {
                            p -= 1
                        }
                    } else {
                        break;
                    }
                }
                if kbase == "float" && p > 0 && lines[p - 1].trim().is_empty() {
                    p -= 1
                }
                by_line.entry(p).or_default().push((
                    if pre { 0 } else { 2 },
                    format!("{ind}//{}", comment_body(text)),
                ));
            }
        }
    }
    let mut intro_lines: Vec<String> = Vec::new();
    if intro_block {
        intro_lines.push("/*!".to_string());
        intro_lines.extend(intro.iter().cloned());
        intro_lines.push("*/".to_string());
    } else {
        for l in &intro {
            intro_lines.push(if l.is_empty() {
                "//!".to_string()
            } else {
                format!("//! {l}")
            });
        }
    }
    let mut out = String::new();
    if lines.is_empty() {
        for l in &intro_lines {
            out.push_str(l);
            out.push('\n');
        }
    } else {
        // route the module docs through the same slot as line-0 comments so
        // a `^` preamble comment can sort above them
        let slot = by_line.entry(0).or_default();
        for l in intro_lines.iter().rev() {
            slot.insert(0, (1, l.clone()));
        }
    }
    let tail_map: HashMap<usize, Vec<(String, i64)>> = {
        let mut m: HashMap<usize, Vec<(String, i64)>> = HashMap::new();
        for (p, t, d) in tails {
            m.entry(p).or_default().push((t, d))
        }
        m
    };
    for (i, l) in lines.iter().enumerate() {
        if let Some(v) = by_line.get_mut(&i) {
            v.sort_by_key(|(rank, _)| *rank);
            for (_, t) in v {
                out.push_str(t.as_str());
                out.push('\n');
            }
        }
        out.push_str(l);
        if let Some(ts) = tail_map.get(&i) {
            for (t, d) in ts {
                let pad = " ".repeat((1 + d).max(0) as usize);
                out.push_str(&format!("{pad}//{}", comment_body(t)));
            }
        }
        out.push('\n');
    }
    out
}
fn ast_equal_mod_docs(a: &str, b: &str) -> Result<bool, Box<dyn Error>> {
    let fa = syn::parse_file(a)?;
    let fb = syn::parse_file(b)?;
    let ta = strip_token_docs(quote::ToTokens::to_token_stream(&fa));
    let tb = strip_token_docs(quote::ToTokens::to_token_stream(&fb));
    Ok(ta.to_string() == tb.to_string())
}
pub(crate) fn rs_names(dir: &str) -> Result<Vec<String>, Box<dyn Error>> {
    // Relative stems, subdirectories included: `src/de/mod.rs` under `src`
    // comes back as `de/mod`, so callers can keep using `{dir}/{name}.rs`.
    fn walk(dir: &str, prefix: &str, names: &mut Vec<String>) -> Result<(), Box<dyn Error>> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let p = entry.path();
            // Symlinks are skipped: crates use them to alias whole source
            // trees (serde's `src/core -> ../../serde_core/src`) and
            // following one would duplicate output or loop.
            if entry.file_type()?.is_symlink() {
                continue;
            }
            let file_name = p.file_name().unwrap().to_string_lossy().to_string();
            if p.is_dir() {
                walk(
                    &p.to_string_lossy(),
                    &format!("{prefix}{file_name}/"),
                    names,
                )?;
            } else if p.extension().map(|e| e == "rs").unwrap_or(false) {
                let stem = p.file_stem().unwrap().to_string_lossy();
                names.push(format!("{prefix}{stem}"));
            }
        }
        Ok(())
    }
    let mut names = Vec::new();
    walk(dir, "", &mut names)?;
    names.sort();
    Ok(names)
}
fn ensure_parent(path: &str) -> Result<(), Box<dyn Error>> {
    if let Some(parent) = std::path::Path::new(path).parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}
pub fn strip_dir(src_dir: &str, out_dir: &str) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(out_dir)?;
    let mut bad = 0;
    for name in rs_names(src_dir)? {
        let src = fs::read_to_string(format!("{src_dir}/{name}.rs"))?;
        let st = strip_source(&src);
        let (entries, docs) = collect_strip(&st.slines, !st.intro.is_empty());
        ensure_parent(&format!("{out_dir}/{name}.rs"))?;
        fs::write(format!("{out_dir}/{name}.rs"), &st.text)?;
        let sc = render_strip_sidecar(&name, &st.intro, st.intro_block, &docs, &entries);
        if !sc.is_empty() {
            fs::write(format!("{out_dir}/{name}.doc.md"), sc)?;
        }
        let status = match ast_equal_mod_docs(&src, &st.text) {
            Ok(true) => "AST-VERIFIED".to_string(),
            Ok(false) => {
                bad += 1;
                "AST-MISMATCH".to_string()
            }
            Err(e) => format!("AST-SKIP ({e})"),
        };
        eprintln!("strip {name}.rs: {status}");
    }
    if bad > 0 {
        return Err(format!("{bad} file(s) failed AST verification").into());
    }
    Ok(())
}
pub fn restore_dir(src_dir: &str, out_dir: &str) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(out_dir)?;
    for name in rs_names(src_dir)? {
        let stripped = fs::read_to_string(format!("{src_dir}/{name}.rs"))?;
        let sidecar = fs::read_to_string(format!("{src_dir}/{name}.doc.md")).unwrap_or_default();
        let restored = if sidecar.is_empty() {
            stripped
        } else {
            restore_source(&stripped, &sidecar)
        };
        ensure_parent(&format!("{out_dir}/{name}.rs"))?;
        fs::write(format!("{out_dir}/{name}.rs"), restored)?;
        eprintln!("restore {name}.rs");
    }
    Ok(())
}
pub fn roundtrip_dir(src_dir: &str, work_dir: &str) -> Result<(), Box<dyn Error>> {
    let s1 = format!("{work_dir}/strip1");
    let rest = format!("{work_dir}/restored");
    let s2 = format!("{work_dir}/strip2");
    strip_dir(src_dir, &s1)?;
    restore_dir(&s1, &rest)?;
    strip_dir(&rest, &s2)?;
    let mut fix_bad = 0;
    let mut exact = 0;
    let mut total = 0;
    for name in rs_names(src_dir)? {
        total += 1;
        let a = fs::read_to_string(format!("{s1}/{name}.rs"))?;
        let b = fs::read_to_string(format!("{s2}/{name}.rs"))?;
        let da = fs::read_to_string(format!("{s1}/{name}.doc.md")).unwrap_or_default();
        let db = fs::read_to_string(format!("{s2}/{name}.doc.md")).unwrap_or_default();
        let fp = a == b && da == db;
        if !fp {
            fix_bad += 1
        }
        let orig = fs::read_to_string(format!("{src_dir}/{name}.rs"))?;
        let restored = fs::read_to_string(format!("{rest}/{name}.rs"))?;
        if orig == restored {
            exact += 1
        }
        println!(
            "roundtrip {name}.rs: fixpoint={} restored-exact={}",
            if fp { "ok" } else { "MISMATCH" },
            orig == restored
        );
    }
    println!("roundtrip: {total} files, fixpoint failures {fix_bad}, byte-exact restores {exact}/{total}");
    if fix_bad > 0 {
        return Err(format!("{fix_bad} fixpoint failure(s)").into());
    }
    Ok(())
}
fn push_block_text(
    t: String,
    mode: i64,
    ind: usize,
    above: &mut Vec<AboveNote>,
    docs: &mut Vec<String>,
    intro: &mut Vec<String>,
) {
    if t.is_empty() && mode == 0 {
        return;
    }
    let pre = docs.is_empty();
    match mode {
        1 => intro.push(t),
        2 => docs.push(t),
        _ => above.push(AboveNote {
            text: t,
            detached: false,
            indent: ind,
            pre_docs: pre,
            pre_intro: false,
            sealed: false,
        }),
    }
}
pub(crate) fn comment_body(text: &str) -> String {
    if text.is_empty() {
        String::new()
    } else if text.starts_with('/') || text.starts_with(' ') {
        text.to_string()
    } else {
        format!(" {text}")
    }
}
