use crate::comments::*;

use std::sync::OnceLock;

pub fn re(pat: &'static str, cell: &'static OnceLock<regex::Regex>) -> &'static regex::Regex {
    cell.get_or_init(|| regex::Regex::new(pat).unwrap())
}
pub fn strip_lits(line: &str) -> String {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    re(
        r####"b?r#"(?s).*?"#|b?r"[^"]*"|b?"(\\.|[^"\\])*"|'(\\.|[^'\\])'"####,
        &RE,
    )
    .replace_all(line, "\"\"")
    .to_string()
}
pub fn count_of(s: &str, chars: &[char]) -> usize {
    s.chars().filter(|c| chars.contains(c)).count()
}
pub fn ends_terminated(bare: &str) -> bool {
    bare.ends_with(';')
        || bare.ends_with('{')
        || bare.ends_with('}')
        || bare.ends_with(',')
        || (bare.starts_with("#[") && bare.ends_with(']'))
}
pub fn looks_like_literal_body(next: &str) -> bool {
    static RE_FIELD: OnceLock<regex::Regex> = OnceLock::new();
    re(r"^(\.\.|\w+\s*:[^:]|\w+\s*,\s*$|\w+\s*$)", &RE_FIELD).is_match(next.trim())
}
pub fn macro_open_depth(bare: &str) -> i64 {
    static MACSTART: OnceLock<regex::Regex> = OnceLock::new();
    if bare.trim_start().starts_with("macro_rules!") {
        let d = count_of(bare, &['{', '(', '[']) as i64 - count_of(bare, &['}', ')', ']']) as i64;
        return if d > 0 { d } else { 0 };
    }
    let rx = re(r"(^|[^\w!])\w+!\s*[({\[]", &MACSTART);
    let mut pos = 0usize;
    while let Some(m) = rx.find(&bare[pos..]) {
        let start = pos + m.end() - 1;
        let mut d = 0i64;
        let mut end = bare.len();
        for (i, ch) in bare[start..].char_indices() {
            match ch {
                '{' | '(' | '[' => d += 1,
                '}' | ')' | ']' => d -= 1,
                _ => {}
            }
            if d == 0 {
                end = start + i + 1;
                break;
            }
        }
        if d > 0 {
            return d;
        }
        pos = end;
    }
    0
}
pub fn bare_update(line: &str, str_open: &mut bool) -> String {
    let mut out = String::new();
    let cs: Vec<char> = line.chars().collect();
    let mut i = 0usize;
    if *str_open {
        let mut esc = false;
        let mut closed = None;
        while i < cs.len() {
            let ch = cs[i];
            if esc {
                esc = false
            } else if ch == '\\' {
                esc = true
            } else if ch == '"' {
                closed = Some(i);
                break;
            }
            i += 1;
        }
        match closed {
            Some(ci) => {
                out.push('"');
                *str_open = false;
                i = ci + 1;
            }
            None => return out,
        }
    }
    while i < cs.len() {
        let ch = cs[i];
        if ch == '"' {
            let prev = if i > 0 { cs[i - 1] } else { ' ' };
            let raw = prev == 'r' || (prev == '#' && i >= 2);
            if raw {
                let mut hashes = 0usize;
                let mut k = i;
                while k > 0 && cs[k - 1] == '#' {
                    hashes += 1;
                    k -= 1;
                }
                let mut j = i + 1;
                let mut done = None;
                while j < cs.len() {
                    if cs[j] == '"' {
                        let mut h = 0usize;
                        while j + 1 + h < cs.len() && cs[j + 1 + h] == '#' && h < hashes {
                            h += 1
                        }
                        if h == hashes {
                            done = Some(j + hashes);
                            break;
                        }
                    }
                    j += 1;
                }
                match done {
                    Some(e) => {
                        out.push('"');
                        out.push('"');
                        i = e + 1;
                        continue;
                    }
                    None => {
                        out.push('"');
                        *str_open = true;
                        return out;
                    }
                }
            }
            let mut esc = false;
            let mut j = i + 1;
            let mut done = None;
            while j < cs.len() {
                let c2 = cs[j];
                if esc {
                    esc = false
                } else if c2 == '\\' {
                    esc = true
                } else if c2 == '"' {
                    done = Some(j);
                    break;
                }
                j += 1;
            }
            match done {
                Some(e) => {
                    out.push('"');
                    out.push('"');
                    i = e + 1;
                }
                None => {
                    out.push('"');
                    *str_open = true;
                    return out;
                }
            }
        } else if ch == '\'' {
            if i + 2 < cs.len() && cs[i + 1] == '\\' {
                let mut j = i + 2;
                while j < cs.len() && cs[j] != '\'' {
                    j += 1
                }
                if j < cs.len() {
                    out.push('\'');
                    out.push('\'');
                    i = j + 1;
                } else {
                    out.push(ch);
                    i += 1;
                }
            } else if i + 2 < cs.len() && cs[i + 2] == '\'' && cs[i + 1] != '\'' {
                out.push('\'');
                out.push('\'');
                i += 3;
            } else {
                out.push(ch);
                i += 1;
            }
        } else {
            out.push(ch);
            i += 1;
        }
    }
    out
}
pub fn angle_delta(lb: &str) -> i64 {
    let mut ang = 0i64;
    let cs: Vec<char> = lb.chars().collect();
    let mut ci = 0usize;
    while ci < cs.len() {
        let ch = cs[ci];
        let prev_ch = if ci > 0 { cs[ci - 1] } else { ' ' };
        let next_ch = cs.get(ci + 1).copied().unwrap_or(' ');
        let after2 = cs.get(ci + 2).copied().unwrap_or(' ');
        if (ch == '<' && next_ch == '<' || ch == '>' && next_ch == '>')
            && prev_ch == ' '
            && after2 == ' '
        {
            ci += 2;
            continue;
        }
        let op_like = prev_ch == ' ' && (next_ch == ' ' || next_ch == '=');
        match ch {
            '<' if !op_like => ang += 1,
            '>' if prev_ch != '-' && !op_like => ang -= 1,
            _ => {}
        }
        ci += 1;
    }
    ang
}
pub fn join_wrapped(input: &[String]) -> Vec<String> {
    static RE_CLOSURE_OPEN: OnceLock<regex::Regex> = OnceLock::new();
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut buf_bare = String::new();
    let mut lit_depth = 0i64;
    let mut str_open = false;
    let mut depth = 0i64;
    let mut ang = 0i64;
    let mut pipes = 0usize;
    let mut has_arrow = false;
    let mut closure_open = false;
    for (i, line) in input.iter().enumerate() {
        let open_string = !buf.is_empty() && str_open;
        let t = if open_string {
            line.as_str()
        } else {
            line.trim_start()
        };
        if t.trim().is_empty() && !open_string {
            continue;
        }
        if !open_string && t.starts_with("//") {
            if !buf.is_empty()
                && depth <= 0
                && !buf_bare.ends_with("&& {")
                && !buf_bare.ends_with("|| {")
            {
                out.push(strip_trailing_commas(std::mem::take(&mut buf).trim_end()));
                buf_bare.clear();
                lit_depth = 0;
                str_open = false;
                depth = 0;
                ang = 0;
                pipes = 0;
                has_arrow = false;
                closure_open = false;
            }
            continue;
        }
        if buf.is_empty() {
            buf = t.to_string();
            buf_bare.clear();
            str_open = false;
            depth = 0;
            ang = 0;
            pipes = 0;
            has_arrow = false;
            closure_open = false;
        } else if open_string {
            let trailing_bs = buf.chars().rev().take_while(|c| *c == '\\').count();
            if trailing_bs % 2 == 1 {
                buf.pop();
                buf.push_str(t.trim_start());
            } else {
                buf.push_str("\\n");
                buf.push_str(t);
            }
        } else {
            let glue = if buf.ends_with('(')
                || t.starts_with(')')
                || (t.starts_with('.') && !t.starts_with(".."))
                || t.starts_with(']')
            {
                ""
            } else {
                " "
            };
            buf.push_str(glue);
            buf.push_str(t);
        }
        let lb = bare_update(t, &mut str_open);
        buf_bare.push_str(lb.trim_end());
        depth += count_of(&lb, &['(', '[']) as i64 - count_of(&lb, &[')', ']']) as i64;
        ang += angle_delta(&lb);
        if lb.contains("=>") {
            has_arrow = true
        }
        if closure_open {
            pipes += count_of(&lb, &['|']);
            if pipes >= 2 {
                closure_open = false
            }
        } else if let Some(m) = re(r"[=(,]\s*(move\s+)?\|($|[^|])", &RE_CLOSURE_OPEN).find(&lb) {
            let after = &lb[m.start()..];
            let n_pipes = count_of(after, &['|']);
            if n_pipes < 2 {
                closure_open = true;
                pipes = n_pipes;
            }
        }
        if str_open {
            continue;
        }
        let line_bare = lb;
        let next = input.get(i + 1).map(|l| l.trim()).unwrap_or("");
        if lit_depth > 0 {
            lit_depth += count_of(&line_bare, &['{']) as i64 - count_of(&line_bare, &['}']) as i64;
        } else if buf_bare.ends_with('{') && !buf_bare.trim_start().starts_with("match ") {
            let mut j = i + 1;
            while input
                .get(j)
                .map(|l| l.trim().starts_with("#["))
                .unwrap_or(false)
            {
                j += 1
            }
            let probe = input.get(j).map(|l| l.trim()).unwrap_or("");
            if looks_like_literal_body(next)
                || (next.starts_with("#[") && looks_like_literal_body(probe))
            {
                lit_depth = 1;
            }
        }
        if lit_depth > 0 {
            continue;
        }
        let mut eff_depth = depth;
        if buf_bare.ends_with(',') && ang > 0 {
            eff_depth += ang
        }
        let open_pipes = closure_open && !has_arrow && !buf_bare.ends_with(';');
        let has_cond_brace = buf_bare.contains("&& {") || buf_bare.contains("|| {");
        let cond_block = buf_bare.ends_with("&& {")
            || buf_bare.ends_with("|| {")
            || (buf_bare.ends_with("} {") && has_cond_brace);
        let next_closer = next.starts_with('}') && !(next.starts_with("} {") && has_cond_brace);
        let terminated = (ends_terminated(&buf_bare) || next_closer || next.is_empty())
            && !open_pipes
            && !cond_block;
        let chained = (next.starts_with('.')
            || next.starts_with("as ")
            || next.starts_with('?')
            || next.starts_with("+ ")
            || next.starts_with("&& ")
            || next.starts_with("|| "))
            && !buf_bare.ends_with(';');
        if std::env::var("R2T_DEBUG_JOIN").is_ok() {
            eprintln!("JOIN i={i} d={depth} eff={eff_depth} lit={lit_depth} term={terminated} chain={chained} pipes={pipes} co={closure_open} tail={:?}", &buf_bare[buf_bare.len().saturating_sub(35)..]);
        }
        if eff_depth <= 0 && terminated && !chained {
            out.push(strip_trailing_commas(std::mem::take(&mut buf).trim_end()));
            buf_bare.clear();
            str_open = false;
            depth = 0;
            ang = 0;
            pipes = 0;
            has_arrow = false;
            closure_open = false;
        }
    }
    if !buf.is_empty() {
        out.push(strip_trailing_commas(buf.trim_end()))
    }
    out
}
pub fn strip_trailing_commas(line: &str) -> String {
    let blanked = blank_strings(line);
    let mut keep: Vec<bool> = vec![true; line.len()];
    let bytes = blanked.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b',' {
            let mut j = i + 1;
            while j < bytes.len() && (bytes[j] == b' ') {
                j += 1
            }
            if j < bytes.len() && (bytes[j] == b')' || bytes[j] == b']') {
                for k in i..j {
                    keep[k] = false
                }
            }
        }
        i += 1;
    }
    line.char_indices()
        .filter(|(idx, _)| *keep.get(*idx).unwrap_or(&true))
        .map(|(_, c)| c)
        .collect()
}
pub fn convert_sig(t: &str) -> String {
    let start = match t.find("fn ") {
        Some(s)
            if t[..s]
                .chars()
                .all(|c| c.is_alphanumeric() || c == ' ' || c == '_' || c == '"') =>
        {
            s
        }
        _ => return t.to_string(),
    };
    let rest = &t[start + 3..];
    let name_end = rest
        .find(|c: char| !c.is_alphanumeric() && c != '_')
        .unwrap_or(rest.len());
    let name = &rest[..name_end];
    let mut i = start + 3 + name_end;
    let bytes: Vec<char> = t.chars().collect();
    let mut generics = String::new();
    if bytes.get(i) == Some(&'<') {
        let mut depth = 0i64;
        let g0 = i;
        while i < bytes.len() {
            match bytes[i] {
                '<' => depth += 1,
                '>' => {
                    depth -= 1;
                    if depth == 0 {
                        i += 1;
                        break;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        generics = bytes[g0..i].iter().collect();
    }
    while bytes.get(i) == Some(&' ') {
        i += 1
    }
    if bytes.get(i) != Some(&'(') {
        return t.to_string();
    }
    let mut depth = 0i64;
    let p0 = i;
    while i < bytes.len() {
        match bytes[i] {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    i += 1;
                    break;
                }
            }
            _ => {}
        }
        i += 1;
    }
    let params_raw: String = bytes[p0 + 1..i - 1].iter().collect();
    let mut after: String = bytes[i..].iter().collect();
    after = after.trim_start().to_string();
    if after.starts_with("->") {
        after = after[2..].trim_start().to_string();
    }
    static PARAM_RE: OnceLock<regex::Regex> = OnceLock::new();
    let param_re = re(r"^(mut\s+)?(\w+):\s*", &PARAM_RE);
    let mut parts = Vec::new();
    let mut d = 0i64;
    let mut cur = String::new();
    let mut prev = ' ';
    for ch in params_raw.chars() {
        match ch {
            '<' | '(' | '[' | '{' => d += 1,
            ')' | ']' | '}' => d -= 1,
            '>' if prev != '-' => d -= 1,
            _ => {}
        }
        if ch == ',' && d == 0 {
            parts.push(std::mem::take(&mut cur))
        } else {
            cur.push(ch)
        }
        prev = ch;
    }
    if !cur.trim().is_empty() {
        parts.push(cur)
    }
    let converted: Vec<String> = parts
        .iter()
        .map(|p| {
            let t = p.trim();
            match param_re.captures(t) {
                Some(c) if !t[c.get(0).unwrap().end()..].starts_with(':') => {
                    format!(
                        "{}{} {}",
                        c.get(1).map(|m| m.as_str()).unwrap_or(""),
                        &c[2],
                        &t[c.get(0).unwrap().end()..]
                    )
                }
                _ => t.to_string(),
            }
        })
        .collect();
    let mut out = t[..start].to_string();
    out.push_str(&format!("fn {name}{generics}({})", converted.join(", ")));
    if !after.is_empty() {
        out.push(' ');
        out.push_str(&after);
    }
    out
}
pub fn mask_lits(line: &str) -> (String, Vec<String>) {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let mut lits: Vec<String> = Vec::new();
    let masked = re(
        r####"b?r#"(?s).*?"#|b?r"[^"]*"|b?"(\\.|[^"\\])*"|'(\\.|[^'\\])'"####,
        &RE,
    )
    .replace_all(line, |c: &regex::Captures| {
        lits.push(c[0].to_string());
        format!("\0{}\0", lits.len() - 1)
    })
    .to_string();
    (masked, lits)
}
pub fn restore_lits(line: &str, lits: &[String]) -> String {
    let mut out = line.to_string();
    for (i, l) in lits.iter().enumerate() {
        out = out.replace(&format!("\0{i}\0"), l);
    }
    out
}
pub fn in_macro_call(ctx: &str) -> bool {
    let mut stack: Vec<bool> = Vec::new();
    let mut after_bang = false;
    for ch in ctx.chars() {
        match ch {
            '!' => after_bang = true,
            '(' | '[' | '{' => {
                stack.push(after_bang);
                after_bang = false;
            }
            ')' | ']' | '}' => {
                stack.pop();
                after_bang = false;
            }
            ' ' => {}
            _ => after_bang = false,
        }
    }
    stack.iter().any(|m| *m)
}
pub fn convert_line(raw: &str, siblings: &[String], in_fields: bool) -> String {
    static LETMUT: OnceLock<regex::Regex> = OnceLock::new();
    static LETPLAIN: OnceLock<regex::Regex> = OnceLock::new();
    static CONSTRE: OnceLock<regex::Regex> = OnceLock::new();
    static FIELDRE: OnceLock<regex::Regex> = OnceLock::new();
    let (masked, lits) = mask_lits(raw.trim());
    let mut t = masked;
    t = re(
        r"^let\s+mut\s+(\w+)(:\s*(?:[^=\[]|\[[^\]]*\])+?)?\s*=\s*",
        &LETMUT,
    )
    .replace(&t, |c: &regex::Captures| {
        let ty = c
            .get(2)
            .map(|m| m.as_str().trim_end().to_string())
            .unwrap_or_default();
        format!("mut {}{} := ", &c[1], ty)
    })
    .to_string();
    t = re(
        r"^let\s+(\([^)]*\)|\w+)(:\s*(?:[^=\[]|\[[^\]]*\])+?)?\s*=\s*([^=])",
        &LETPLAIN,
    )
    .replace(&t, |c: &regex::Captures| {
        let ty = c
            .get(2)
            .map(|m| m.as_str().trim_end().to_string())
            .unwrap_or_default();
        format!("{}{} := {}", &c[1], ty, &c[3])
    })
    .to_string();
    if t.contains("fn ") {
        t = convert_sig(&t)
    }
    t = re(r"^const\s+(\w+):\s*", &CONSTRE)
        .replace(&t, "const $1 ")
        .to_string();
    if in_fields {
        t = re(r"^(pub\s+)?(\w+):\s+", &FIELDRE)
            .replace(&t, "$2 ")
            .to_string();
    }
    if !siblings.is_empty() {
        let mut stripped = String::new();
        let mut rest = t.as_str();
        loop {
            let found = siblings
                .iter()
                .filter_map(|s| rest.find(&format!("{s}::")).map(|i| (i, s.len() + 2)))
                .min();
            match found {
                Some((i, len)) => {
                    let before = &rest[..i];
                    let ctx = format!("{stripped}{before}");
                    if !in_macro_call(&ctx) {
                        stripped.push_str(before);
                        rest = &rest[i + len..];
                    } else {
                        stripped.push_str(&rest[..i + len]);
                        rest = &rest[i + len..];
                    }
                }
                None => {
                    stripped.push_str(rest);
                    break;
                }
            }
        }
        t = stripped;
    }
    if t.ends_with(';') && !t.ends_with("};") {
        t.pop();
    }
    restore_lits(t.trim_end(), &lits)
}
