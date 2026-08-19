use crate::comments::*;
use crate::compare::*;
use crate::textual::*;

use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::sync::OnceLock;

pub(crate) struct SLine {
    pub code: String,
    pub above: Vec<(String, bool)>,
    pub tail: Option<String>,
    pub docs: Vec<String>,
}
struct Stripped {
    pub text: String,
    pub slines: Vec<SLine>,
    pub intro: Vec<String>,
}
pub(crate) struct JoinedRaw {
    pub text: String,
    pub lo: usize,
    pub hi: usize,
}
fn cut_line_comment(line: &str, keep_safety: bool) -> (String, Option<String>, Option<String>) {
    match find_line_comment(line) {
        None => (line.to_string(), None, None),
        Some(sl) => {
            let raw = line[sl + 2..].trim_end();
            let text = match raw.strip_prefix(' ') {
                Some(r) if !r.starts_with(' ') && !r.starts_with('/') => r.to_string(),
                _ => raw.to_string(),
            };
            let before = line[..sl].to_string();
            if keep_safety && text.starts_with("SAFETY") {
                return (before.trim_end().to_string(), None, Some(text));
            }
            (before.trim_end().to_string(), Some(text), None)
        }
    }
}
fn strip_source(src: &str) -> Stripped {
    let mut out: Vec<String> = Vec::new();
    let mut slines: Vec<SLine> = Vec::new();
    let mut pending_above: Vec<(String, bool)> = Vec::new();
    let mut pending_docs: Vec<String> = Vec::new();
    let mut intro: Vec<String> = Vec::new();
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
            let (cv, _, _) = cut_line_comment(&line, false);
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
                    let t = line[..e].trim().to_string();
                    push_block_text(
                        t,
                        block_mode,
                        &mut pending_above,
                        &mut pending_docs,
                        &mut intro,
                    );
                    line = line[e + 2..].to_string();
                    in_block = false;
                    block_mode = 0;
                    changed = true;
                }
                None => {
                    let t = line.trim().to_string();
                    push_block_text(
                        t,
                        block_mode,
                        &mut pending_above,
                        &mut pending_docs,
                        &mut intro,
                    );
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
                    let txt = line[s + 2 + mstrip..s + 2 + mstrip + rel]
                        .trim()
                        .to_string();
                    if standalone && mode == 0 && txt.starts_with("SAFETY") {
                        keep_whole = true;
                        break;
                    }
                    push_block_text(txt, mode, &mut pending_above, &mut pending_docs, &mut intro);
                    line = format!("{}{}", &line[..s], &line[s + 4 + mstrip + rel..]);
                    changed = true;
                }
                None => {
                    let txt = line[s + 2 + mstrip..].trim().to_string();
                    if standalone && mode == 0 && txt.starts_with("SAFETY") {
                        out.push(line.clone());
                        in_block = true;
                        keep_block = true;
                        keep_whole = true;
                        break;
                    }
                    push_block_text(txt, mode, &mut pending_above, &mut pending_docs, &mut intro);
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
            continue;
        }
        let t = line.trim();
        if safety_cont && t.starts_with("//") && !t.starts_with("///") {
            out.push(line.trim_end().to_string());
            continue;
        }
        safety_cont = false;
        if t.starts_with("//!") {
            intro.push(t[3..].strip_prefix(" ").unwrap_or(&t[3..]).to_string());
            continue;
        }
        if t.starts_with("///") && !t.starts_with("////") {
            pending_docs.push(t[3..].strip_prefix(" ").unwrap_or(&t[3..]).to_string());
            continue;
        }
        let (code, above, safety_tail) = cut_line_comment(&line, true);
        let mut tail = None;
        if let Some(a) = above {
            if code.trim().is_empty() {
                pending_above.push((a, false));
                changed = true;
            } else {
                tail = Some(a);
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
                    for p in pending_above.iter_mut() {
                        p.1 = true
                    }
                }
                out.push(line.trim_end().to_string());
            } else if safety_tail.is_some() {
                out.push(emit);
                safety_cont = true;
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
    Stripped {
        text: format!("{}\n", out.join("\n")),
        slines,
        intro,
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
    for j in joined {
        let t = j.text.trim();
        let mut resolved = false;
        let scope_depth = stack.last().map(|s| s.1 + 1).unwrap_or(0);
        let top_kind = stack.last().map(|s| s.2).unwrap_or(0);
        let bare = strip_lits(t);
        let net = count_of(&bare, &['{']) as i64 - count_of(&bare, &['}']) as i64;
        if depth0 == scope_depth && top_kind == 2 {
            if let Some(v) = variant_name(t) {
                owner = qualify_owner(&stack, v);
                resolved = true;
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
                }
            } else if let Some(m) = scope_mod_name(t) {
                let label = qualify_owner(&stack, m);
                owner = label.clone();
                resolved = true;
                if net > 0 {
                    stack.push((label, depth0, 0))
                }
            } else if let Some(name) = decl_name(t) {
                let label = qualify_owner(&stack, name);
                owner = label.clone();
                resolved = true;
                if net > 0 {
                    if scope_is_trait(t) {
                        stack.push((label, depth0, 1))
                    } else if scope_is_enum(t) {
                        stack.push((label, depth0, 2))
                    } else if scope_is_struct(t) {
                        stack.push((label, depth0, 3))
                    }
                }
            } else if let Some(u) = use_name(t) {
                owner = qualify_owner(&stack, u);
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
fn collect_strip(slines: &[SLine]) -> (Vec<LedgerEntry>, Vec<(String, Vec<String>)>) {
    let joined = join_raw(slines);
    let owners = owner_walk(&joined);
    let keys = phys_keys(slines, &joined, &owners);
    let mut entries = Vec::new();
    let mut docs: Vec<(String, Vec<String>)> = Vec::new();
    let mut doc_pool: Vec<String> = Vec::new();
    for (k, j) in joined.iter().enumerate() {
        let (owner, resolved) = &owners[k];
        for i in j.lo..=j.hi {
            doc_pool.extend(slines[i].docs.iter().cloned());
        }
        if *resolved && !doc_pool.is_empty() {
            docs.push((owner.clone(), std::mem::take(&mut doc_pool)));
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
            for (a, detached) in &slines[i].above {
                let kind = if *detached { "float" } else { "above" };
                entries.push(LedgerEntry {
                    owner: sec.clone(),
                    kind: kind.to_string(),
                    anchor: anchor.clone(),
                    nth: *nth,
                    text: a.clone(),
                });
            }
            if let Some(tl) = &slines[i].tail {
                entries.push(LedgerEntry {
                    owner: sec.clone(),
                    kind: "tail".to_string(),
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
    if let Some(h) = rem.rfind("`#") {
        let after = &rem[h + 2..];
        if let Some(c) = after.find(':') {
            if after[..c].chars().all(|ch| ch.is_ascii_digit()) && !after[..c].is_empty() {
                let nth: usize = after[..c].parse().ok()?;
                let text = after[c + 1..]
                    .strip_prefix(' ')
                    .unwrap_or(&after[c + 1..])
                    .to_string();
                return Some((kind, rem[..h].to_string(), nth, text));
            }
        }
    }
    let h = rem.rfind("`:")?;
    let text = rem[h + 2..]
        .strip_prefix(' ')
        .unwrap_or(&rem[h + 2..])
        .to_string();
    Some((kind, rem[..h].to_string(), 1, text))
}
pub(crate) fn parse_strip_sidecar(s: &str) -> (Vec<String>, Vec<Section>) {
    let mut intro = Vec::new();
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
            if !l.trim().is_empty() {
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
    (intro, sections)
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
        let (code, _, _) = cut_line_comment(line, true);
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
fn restore_source(stripped: &str, sidecar: &str) -> String {
    let (intro, sections) = parse_strip_sidecar(sidecar);
    let lines: Vec<String> = stripped.lines().map(String::from).collect();
    let (slines, phys) = code_lines_of(stripped);
    let joined = join_raw(&slines);
    let owners = owner_walk(&joined);
    let keys = phys_keys(&slines, &joined, &owners);
    let mut by_line: HashMap<usize, Vec<String>> = HashMap::new();
    let mut tails: Vec<(usize, String)> = Vec::new();
    for sec in &sections {
        let match_owner = if sec.owner == "(mod)" {
            String::new()
        } else {
            sec.owner.clone()
        };
        if !sec.docs.is_empty() {
            if let Some(k) = (0..joined.len()).find(|k| owners[*k].1 && owners[*k].0 == match_owner)
            {
                let mut p = phys[joined[k].lo];
                let ind = indent_of(&lines[phys[joined[k].lo]]);
                while p > 0 && lines[p - 1].trim().starts_with("#[") {
                    p -= 1
                }
                let slot = by_line.entry(p).or_default();
                for d in &sec.docs {
                    slot.push(if d.is_empty() {
                        format!("{ind}///")
                    } else {
                        format!("{ind}/// {d}")
                    });
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
            let mut p = phys[i];
            if kind == "tail" {
                tails.push((p, text.clone()));
            } else {
                let ind = indent_of(&lines[p]);
                while p > 0 {
                    let prev = lines[p - 1].trim();
                    if prev.starts_with("//") || prev.starts_with("/*") || prev.starts_with('*') {
                        p -= 1
                    } else {
                        break;
                    }
                }
                if kind == "float" && p > 0 && lines[p - 1].trim().is_empty() {
                    p -= 1
                }
                by_line
                    .entry(p)
                    .or_default()
                    .push(format!("{ind}//{}", comment_body(text)));
            }
        }
    }
    let mut out = String::new();
    for l in &intro {
        out.push_str(
            &(if l.is_empty() {
                "//!".to_string()
            } else {
                format!("//! {l}")
            }),
        );
        out.push('\n');
    }
    let tail_map: HashMap<usize, Vec<String>> = {
        let mut m: HashMap<usize, Vec<String>> = HashMap::new();
        for (p, t) in tails {
            m.entry(p).or_default().push(t)
        }
        m
    };
    for (i, l) in lines.iter().enumerate() {
        if let Some(v) = by_line.get(&i) {
            for t in v {
                out.push_str(t);
                out.push('\n');
            }
        }
        out.push_str(l);
        if let Some(ts) = tail_map.get(&i) {
            for t in ts {
                out.push_str(&format!(" //{}", comment_body(t)));
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
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        let p = entry?.path();
        if p.extension().map(|e| e == "rs").unwrap_or(false) {
            names.push(p.file_stem().unwrap().to_string_lossy().to_string());
        }
    }
    names.sort();
    Ok(names)
}
pub fn strip_dir(src_dir: &str, out_dir: &str) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(out_dir)?;
    let mut bad = 0;
    for name in rs_names(src_dir)? {
        let src = fs::read_to_string(format!("{src_dir}/{name}.rs"))?;
        let st = strip_source(&src);
        let (entries, docs) = collect_strip(&st.slines);
        fs::write(format!("{out_dir}/{name}.rs"), &st.text)?;
        let sc = render_strip_sidecar(&name, &st.intro, &docs, &entries);
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
    above: &mut Vec<(String, bool)>,
    docs: &mut Vec<String>,
    intro: &mut Vec<String>,
) {
    if t.is_empty() && mode == 0 {
        return;
    }
    match mode {
        1 => intro.push(t),
        2 => docs.push(t),
        _ => above.push((t, false)),
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
