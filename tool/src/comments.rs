use crate::textual::*;

use std::collections::HashMap;
use std::sync::OnceLock;

pub struct LedgerEntry {
    pub owner: String,
    pub kind: String,
    pub anchor: String,
    pub nth: usize,
    pub text: String,
}
struct RawLine {
    pub code: String,
    pub above: Vec<String>,
    pub tail: Option<String>,
}
pub fn find_line_comment(line: &str) -> Option<usize> {
    let blanked = blank_strings(line);
    blanked.find("//")
}
pub fn blank_strings(line: &str) -> String {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    re(
        r####"r#"(?s).*?"#|r"[^"]*"|"(\\.|[^"\\])*"|'(\\.|[^'\\])'"####,
        &RE,
    )
    .replace_all(line, |c: &regex::Captures| "S".repeat(c[0].len()))
    .to_string()
}
pub fn extract_ledger(src: &str, siblings: &[String]) -> Vec<LedgerEntry> {
    let mut raws = Vec::new();
    let mut pending_above = Vec::new();
    let mut in_block = false;
    for line in src.lines() {
        let mut line = line.to_string();
        if in_block {
            match line.find("*/") {
                Some(e) => {
                    pending_above.push(line[..e].trim().to_string());
                    line = line[e + 2..].to_string();
                    in_block = false;
                }
                None => {
                    pending_above.push(line.trim().to_string());
                    continue;
                }
            }
        }
        loop {
            let s = match line.find("/*") {
                Some(s) if blank_strings(&line).as_bytes().get(s) == Some(&b'/') => s,
                _ => break,
            };
            match line[s + 2..].find("*/") {
                Some(rel) => {
                    let txt = line[s + 2..s + 2 + rel].trim().to_string();
                    if !txt.is_empty() {
                        pending_above.push(txt)
                    }
                    line = format!("{}{}", &line[..s], &line[s + 4 + rel..]);
                }
                None => {
                    pending_above.push(line[s + 2..].trim().to_string());
                    line = line[..s].to_string();
                    in_block = true;
                    break;
                }
            }
        }
        let t = line.trim();
        if t.starts_with("//!") || t.starts_with("///") {
            continue;
        }
        let mut tail = None;
        if let Some(sl) = find_line_comment(&line) {
            let text = line[sl + 2..].trim().to_string();
            if line[..sl].trim().is_empty() {
                if !text.is_empty() {
                    pending_above.push(text)
                }
            } else if !text.is_empty() {
                tail = Some(text)
            }
            line = line[..sl].to_string();
        }
        if line.trim().is_empty() {
            continue;
        }
        raws.push(RawLine {
            code: line.trim_end().to_string(),
            above: std::mem::take(&mut pending_above),
            tail,
        });
    }
    join_and_anchor(&raws, siblings)
}
struct Joined {
    pub text: String,
    pub above: Vec<String>,
    pub tails: Vec<String>,
}
fn join_and_anchor(raws: &[RawLine], siblings: &[String]) -> Vec<LedgerEntry> {
    let mut joined: Vec<Joined> = Vec::new();
    let mut buf: Option<Joined> = None;
    for (i, r) in raws.iter().enumerate() {
        let t = r.code.trim();
        match buf.as_mut() {
            None => {
                buf = Some(Joined {
                    text: t.to_string(),
                    above: r.above.clone(),
                    tails: r.tail.iter().cloned().collect(),
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
                b.above.extend(r.above.iter().cloned());
                if let Some(tl) = &r.tail {
                    b.tails.push(tl.clone())
                }
            }
        }
        let b = buf.as_ref().unwrap();
        let bare = strip_lits(&b.text);
        let depth = count_of(&bare, &['(', '[']) as i64 - count_of(&bare, &[')', ']']) as i64;
        let next = raws.get(i + 1).map(|r| r.code.trim()).unwrap_or("");
        let terminated = ends_terminated(&bare) || next.starts_with('}') || next.is_empty();
        if depth <= 0 && terminated {
            joined.push(buf.take().unwrap());
        }
    }
    if let Some(b) = buf {
        joined.push(b)
    }
    let mut entries = Vec::new();
    let mut shadows: HashMap<String, Vec<String>> = HashMap::new();
    let mut owner = String::new();
    let mut impl_ctx = String::new();
    let mut depth0 = 0i64;
    for j in &joined {
        let t = j.text.trim();
        let converted = convert_line(t, siblings, false);
        if depth0 == 0 {
            if let Some(ty) = impl_target(&converted) {
                impl_ctx = ty.clone();
                owner = ty;
            } else if let Some(name) = decl_name(&converted) {
                owner = name;
                impl_ctx.clear();
            } else if !converted.trim_start().starts_with("#[") {
                impl_ctx.clear();
            }
        } else if depth0 == 1 && !impl_ctx.is_empty() {
            if let Some(m) = method_name(&converted) {
                owner = format!("{impl_ctx}::{m}");
            }
        }
        let anchor = converted.trim().to_string();
        let shadow = shadows.entry(owner.clone()).or_default();
        shadow.push(anchor.clone());
        let nth = shadow.iter().filter(|l| **l == anchor).count();
        for a in &j.above {
            if !owner.is_empty() && !a.is_empty() {
                entries.push(LedgerEntry {
                    owner: owner.clone(),
                    kind: "above".to_string(),
                    anchor: anchor.clone(),
                    nth,
                    text: a.clone(),
                });
            }
        }
        for tl in &j.tails {
            if !owner.is_empty() {
                entries.push(LedgerEntry {
                    owner: owner.clone(),
                    kind: "tail".to_string(),
                    anchor: anchor.clone(),
                    nth,
                    text: tl.clone(),
                });
            }
        }
        let bare = strip_lits(t);
        depth0 += count_of(&bare, &['{']) as i64 - count_of(&bare, &['}']) as i64;
    }
    entries
}
pub fn decl_name(t: &str) -> Option<String> {
    static RE_DECL: OnceLock<regex::Regex> = OnceLock::new();
    re(r"^(?:#\[[^\]]*\]\s*)*(?:priv\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|unsafe\s+|const\s+)*(?:fn|struct|enum|trait|union|type|const|static)\s+(\w+)", &RE_DECL).captures(t).map(|c| c[1].to_string())
}
pub fn macro_rules_name(t: &str) -> Option<String> {
    static RE_MAC: OnceLock<regex::Regex> = OnceLock::new();
    re(r"^macro_rules!\s*(\w+)", &RE_MAC)
        .captures(t)
        .map(|c| c[1].to_string())
}
pub fn impl_target(t: &str) -> Option<String> {
    static RE_FOR: OnceLock<regex::Regex> = OnceLock::new();
    static RE_IMPL: OnceLock<regex::Regex> = OnceLock::new();
    let head = t.trim_start();
    if !head.starts_with("impl") {
        return None;
    }
    if let Some(c) = re(
        r"\bfor\s+&?(?:mut\s+)?(?:dyn\s+)?(?:[\w]+::)*([A-Za-z_]\w*)",
        &RE_FOR,
    )
    .captures(head)
    {
        return Some(c[1].to_string());
    }
    re(
        r"^impl\s*(?:<[^{]*?>)?\s*&?(?:mut\s+)?(?:dyn\s+)?(?:[\w]+::)*([A-Za-z_]\w*)",
        &RE_IMPL,
    )
    .captures(head)
    .map(|c| c[1].to_string())
}
pub fn method_name(t: &str) -> Option<String> {
    static RE_METHOD: OnceLock<regex::Regex> = OnceLock::new();
    re(r"^(?:#\[[^\]]*\]\s*)*(?:priv\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|unsafe\s+|const\s+)*fn\s+(\w+)", &RE_METHOD).captures(t).map(|c| c[1].to_string())
}
