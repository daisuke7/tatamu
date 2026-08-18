#!/usr/bin/env node
// tatamuc — Tatamu v0.1 → Rust transpiler (Stage 1 MVP).
//
// Implemented rules (see docs/02-paper-prototype.md):
//   F1/F2  newline-terminated statements, no indentation → semicolons + rustfmt-ish indent
//   S1     `x := e` / `mut x := e` / `(a, b) := e`  →  `let x = e;` etc.
//   S2     `fn f(a T) R {`  →  `fn f(a: T) -> R {`
//   S4     `struct Name +A,B {f T, g U}`  →  `#[derive(A, B)] struct Name { f: T, g: U }`
//   S6     use-injection from a std prelude map
//   S8     `R<T>`  →  `Result<T, Box<dyn Error>>`
//   const  `const NAME Type = expr`  →  `const NAME: Type = expr;`
//
// Not implemented (documented limitations):
//   S7 usage-site turbofish inference — bare `.collect()` may need annotations in Rust
//   enums, generics on user fns, lifetimes, modules, async
//
// Lenient mode (default): tolerates trailing `;` and turbofish in the input
// (both are valid Rust and appear in weaker-model output).

import { readFileSync, statSync } from "node:fs";

// ---------- string-aware segment mapping ----------
// Applies fn(segment) only to parts of the line outside string/char literals.
function outsideStrings(line, fn) {
  let out = "";
  let i = 0;
  const rawStart = (s) => /^r(#*)"/.exec(s);
  while (i < line.length) {
    const c = line[i];
    const raw = c === "r" ? rawStart(line.slice(i)) : null;
    if (raw) {
      // raw string r#"..."# — the body may contain unescaped quotes
      const close = '"' + raw[1];
      let j = line.indexOf(close, i + raw[0].length);
      j = j === -1 ? line.length : j + close.length;
      out += line.slice(i, j);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j += line[j] === "\\" ? 2 : 1;
      out += line.slice(i, Math.min(j + 1, line.length));
      i = Math.min(j + 1, line.length);
    } else if (c === "'" && /^'(\\.|[^\\'])'/.test(line.slice(i))) {
      const m = /^'(\\.|[^\\'])'/.exec(line.slice(i));
      out += m[0];
      i += m[0].length;
    } else {
      let j = i;
      while (
        j < line.length && line[j] !== '"' &&
        !(line[j] === "r" && rawStart(line.slice(j))) &&
        !(line[j] === "'" && /^'(\\.|[^\\'])'/.test(line.slice(j)))
      ) j++;
      if (j === i) j++; // lone `r` that starts a raw-string-looking sequence mid-scan
      out += fn(line.slice(i, j));
      i = j;
    }
  }
  return out;
}

// string-literal contents squashed to empty — for counting/matching passes that
// must never see delimiters or keywords inside strings
function stripLiterals(line) {
  return line
    .replace(/r(#*)".*?"\1/g, '""')
    .replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/'(\\.|[^'\\])'/g, "''");
}

function stripStringsForTest(line) {
  return stripLiterals(line) === line ? outsideStrings(line, (s) => s.replace(/./g, (c) => c)) : line;
}

// ---------- rule transforms (line-local) ----------

// S8: R<T> → Result<T, Box<dyn Error>>  (angle-bracket matched, may nest)
function expandR(seg) {
  let idx;
  while ((idx = seg.search(/\bR</)) !== -1) {
    const start = seg.indexOf("<", idx);
    let depth = 0, j = start;
    for (; j < seg.length; j++) {
      if (seg[j] === "<") depth++;
      else if (seg[j] === ">") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) break; // unbalanced; leave as-is
    const inner = seg.slice(start + 1, j);
    seg = seg.slice(0, idx) + `Result<${inner}, Box<dyn Error>>` + seg.slice(j + 1);
  }
  return seg;
}

// S2: transform every `fn name(params) Ret` occurrence in the segment.
// Generic parameter lists (`fn largest<T: PartialOrd>(…)`) are kept verbatim.
function transformFnSigs(seg) {
  let out = "";
  let i = 0;
  while (i < seg.length) {
    const m = /\bfn\s+([A-Za-z_]\w*)(<)?/.exec(seg.slice(i));
    if (!m) { out += seg.slice(i); break; }
    const fnStart = i + m.index;
    // scan optional generics segment with angle matching
    let generics = "";
    let afterName = i + m.index + m[0].length - (m[2] ? 1 : 0);
    if (m[2]) {
      let depth = 0, g = afterName;
      for (; g < seg.length; g++) {
        if (seg[g] === "<") depth++;
        else if (seg[g] === ">") { depth--; if (depth === 0) { g++; break; } }
      }
      generics = seg.slice(afterName, g);
      afterName = g;
    }
    // require an opening paren next; otherwise not a signature
    const parenRel = seg.slice(afterName).search(/\S/);
    if (parenRel === -1 || seg[afterName + parenRel] !== "(") {
      out += seg.slice(i, afterName);
      i = afterName;
      continue;
    }
    out += seg.slice(i, fnStart);
    const parenOpen = afterName + parenRel;
    let depth = 0, j = parenOpen;
    for (; j < seg.length; j++) {
      if (seg[j] === "(") depth++;
      else if (seg[j] === ")") { depth--; if (depth === 0) break; }
    }
    const params = seg.slice(parenOpen + 1, j);
    // return type = text between `)` and the next `{` (or end / `;`)
    let k = j + 1;
    let braceAt = -1;
    for (let d = 0; k < seg.length; k++) {
      if (seg[k] === "{") { braceAt = k; break; }
    }
    let retRaw = (braceAt === -1 ? seg.slice(j + 1) : seg.slice(j + 1, braceAt)).trim();
    // a where clause is not a return type: `fn f(..) where A: ..` / `fn f(..) T where ..`
    let wherePart = "";
    const wm = /^(.*?)\s*\bwhere\b([\s\S]*)$/.exec(retRaw);
    if (wm) { retRaw = wm[1].trim(); wherePart = ` where${wm[2]}`; }
    // depth-aware split (nested generics/tuples/fn-pointers keep their commas)
    const parts = [];
    {
      let d = 0, cur = "";
      for (let ci = 0; ci < params.length; ci++) {
        const ch = params[ci];
        if (ch === "<" || ch === "(" || ch === "[") d++;
        else if (ch === ")" || ch === "]") d--;
        else if (ch === ">" && params[ci - 1] !== "-") d--;
        if (ch === "," && d === 0) { parts.push(cur); cur = ""; }
        else cur += ch;
      }
      if (cur.trim() !== "") parts.push(cur);
    }
    const newParams = parts.map((p) => {
      const t = p.trim();
      if (t === "" || t === "self" || t === "&self" || t === "&mut self") return t;
      if (/^(&?\s*)?impl\b/.test(t)) return t; // bare impl-Trait parameter type
      const mm = /^(mut\s+)?([A-Za-z_]\w*)\s+(.+)$/.exec(t);
      return mm && mm[2] !== "mut" ? `${mm[1] ?? ""}${mm[2]}: ${mm[3]}` : t;
    }).filter((p) => p !== "").join(", ");
    // already Rust-shaped (macro token streams, idempotent re-runs): keep as-is
    const ret = retRaw ? (retRaw.startsWith("->") ? ` ${retRaw}` : ` -> ${retRaw}`) : "";
    out += `fn ${m[1]}${generics}(${newParams})${ret}${wherePart}${braceAt === -1 ? "" : " "}`;
    i = braceAt === -1 ? seg.length : braceAt;
  }
  return out;
}

// S1: := bindings, with optional type ascription (v0.2): `x: Vec<_> := expr`
function transformBindings(seg) {
  return seg
    .replace(/\bmut\s+([A-Za-z_]\w*)\s*:\s*((?:[^=:]|::)+?)\s*:=/g, "let mut $1: $2 =")
    .replace(/\bmut\s+([A-Za-z_]\w*)\s*:=/g, "let mut $1 =")
    .replace(/(^|[{;]\s*|\s)([A-Za-z_]\w*)\s*:\s*((?:[^=:]|::)+?)\s*:=/g, (mm, pre, name, ty) => `${pre}let ${name}: ${ty} =`)
    .replace(/(\([^()]*\))\s*:=/g, "let $1 =")
    .replace(/(^|[{;]\s*|\s)([A-Za-z_]\w*)\s*:=/g, (mm, pre, name) => `${pre}let ${name} =`);
}

// shared: `name Type` field list → `name: Type` (used by struct and enum variants)
function fieldsToRust(fieldsRaw) {
  return fieldsRaw.split(/,(?![^<[]*[>\]])/).map((f) => {
    let t = f.trim();
    if (t === "") return null;
    // `priv name Type` — field stays non-pub during pubify
    const priv = /^priv\s+/.test(t);
    if (priv) t = t.replace(/^priv\s+/, "");
    const fm = /^([A-Za-z_]\w*)\s+(.+)$/.exec(t);
    return { text: fm ? `${fm[1]}: ${fm[2]}` : t, priv };
  }).filter(Boolean);
}

const deriveAttr = (derives) => `#[derive(${derives.split(",").map((d) => d.trim()).join(", ")})]`;

// S4: struct with +derives and `name Type` fields (single-line form).
// Unit and tuple structs take the derive suffix too: `struct Marker +Debug`,
// `struct Wrap(u8) +Debug,Clone`.
function transformStruct(line) {
  const unit = /^struct\s+(\w+(?:<[^{(]*>)?)\s*(\(.*\))?\s*(?:\+([\w,:\s]+?))?\s*;?\s*$/.exec(line.trim());
  if (unit && !line.includes("{")) {
    const lines = [];
    const privFlags = [];
    if (unit[3]) { lines.push(deriveAttr(unit[3])); privFlags.push(false); }
    lines.push(`struct ${unit[1]}${unit[2] ?? ""};`); privFlags.push(false);
    return { lines, privFlags };
  }
  const m = /^struct\s+(\w+(?:<[^{]*>)?)\s*(?:\+([\w,:\s]+?))?\s*\{(.*)\}\s*$/.exec(line.trim());
  if (!m) return null;
  const [, name, derives, fieldsRaw] = m;
  const lines = [];
  const privFlags = [];
  if (derives) { lines.push(deriveAttr(derives)); privFlags.push(false); }
  lines.push(`struct ${name} {`); privFlags.push(false);
  for (const f of fieldsToRust(fieldsRaw)) { lines.push(`${f.text},`); privFlags.push(f.priv); }
  lines.push(`}`); privFlags.push(false);
  return { lines, privFlags };
}

// enum variant: struct-variants get Tatamu field shorthand (`Rect {w f64, h f64}`)
function transformEnumVariant(line) {
  return line.replace(/([A-Za-z_]\w*)\s*\{([^{}]*)\}/g, (m0, vname, body) =>
    `${vname} {${fieldsToRust(body).map((f) => f.text).join(", ")}}`);
}

// enum header (single-line or multi-line open), with optional +derives
function transformEnumHeader(line) {
  const t = line.trim();
  const single = /^enum\s+(\w+(?:<[^{]*>)?)\s*(?:\+([\w,:\s]+?))?\s*\{(.*)\}\s*$/.exec(t);
  if (single) {
    const [, name, derives, body] = single;
    const lines = [];
    if (derives) lines.push(deriveAttr(derives));
    lines.push(`enum ${name} {${transformEnumVariant(body)}}`);
    return { lines, open: false };
  }
  const multi = /^enum\s+(\w+(?:<[^{]*>)?)\s*(?:\+([\w,:\s]+?))?\s*\{\s*$/.exec(t);
  if (multi) {
    const [, name, derives] = multi;
    const lines = [];
    if (derives) lines.push(deriveAttr(derives));
    lines.push(`enum ${name} {`);
    return { lines, open: true };
  }
  return null;
}

// const NAME Type = expr
function transformConst(line) {
  const m = /^const\s+([A-Z_][A-Z0-9_]*)\s+(.+?)\s*=\s*(.+?);?\s*$/.exec(line.trim());
  if (!m) return null;
  return [`const ${m[1]}: ${m[2]} = ${m[3]};`];
}

// ---------- use-injection prelude map (S6) ----------
const PRELUDE = [
  [/\bHashMap\b/, "use std::collections::HashMap;"],
  [/\bHashSet\b/, "use std::collections::HashSet;"],
  [/\benv::/, "use std::env;"],
  [/\bfs::/, "use std::fs;"],
  [/\bprocess::/, "use std::process;"],
  [/\bBox<dyn Error>/, "use std::error::Error;"],
  [/\bPI\b/, "use std::f64::consts::PI;"],
  [/\bBufReader\b/, "use std::io::BufReader;"],
  [/\bBufRead\b/, "use std::io::BufRead;"],
  [/\bfmt::/, "use std::fmt;"],
  [/\bimpl\s+Display\b/, "use std::fmt::Display;"],
  [/(?<!fmt::)\bFormatter\b/, "use std::fmt::Formatter;"],
  [/\bimpl\s+FromStr\b/, "use std::str::FromStr;"],
  [/\bthread::/, "use std::thread;"],
  [/\bmem::/, "use std::mem;"],
  [/\bmpsc::/, "use std::sync::mpsc;"],
  [/\bArc\b/, "use std::sync::Arc;"],
  [/\bMutex\b/, "use std::sync::Mutex;"],
  [/(?<!cmp::)\bOrdering\b/, "use std::cmp::Ordering;"],
];

// ---------- main transpile ----------

// transpileMapped returns { rust, map } where map[i] is the 1-based .ttm source
// line of output line i (null for injected lines like `use` statements).
export function transpileMapped(src) {
  const rawLines = src.split("\n")
    .map((l, i) => [l.trim(), i + 1])
    .filter(([l]) => l !== "");
  let lines = [];
  const lineSrc = [];
  const linePriv = [];
  const lineVerbatim = [];
  const push = (text, n, priv = false, verbatim = false) => { lines.push(text); lineSrc.push(n); linePriv.push(priv); lineVerbatim.push(verbatim); };

  const extraUses = []; // from `#use path::To::Item` directives
  let inEnumBody = false;
  let enumDepth = 0;
  let inStructBody = false;
  let macroDepth = 0;
  for (const [raw, n] of rawLines) {
    // inside a macro invocation body: a token stream, not Tatamu — verbatim
    if (macroDepth > 0) {
      for (const ch of stripLiterals(raw)) {
        if ("{([".includes(ch)) macroDepth++;
        else if ("})]".includes(ch)) macroDepth--;
      }
      if (macroDepth <= 0) {
        // the closer rejoins normal semicolon logic (let-bound macros get `;`)
        macroDepth = 0;
        push(raw.replace(/;\s*$/, ""), n, false, false);
      } else push(raw, n, false, true);
      continue;
    }
    // lenient: strip an existing trailing semicolon (re-added consistently later)
    let line = raw.replace(/;\s*$/, "");
    // `#use` directive: explicit import escape hatch (mainly for traits)
    const useM = /^#use\s+(.+)$/.exec(line.trim());
    if (useM) { extraUses.push(`use ${useM[1].trim()};`); continue; }
    // `#dep` / `#crate` are project-level directives — inert in single-file mode
    if (/^#(dep|crate)\s/.test(line.trim())) continue;
    // `priv` prefix: this item (or impl method) stays non-pub during pubify
    let privItem = false;
    if (/^priv\s+/.test(line)) { privItem = true; line = line.replace(/^priv\s+/, ""); }
    // multi-line handling: struct/const/enum are line-scoped rules
    const asStruct = line.startsWith("struct ") ? transformStruct(line) : null;
    if (asStruct) {
      asStruct.lines.forEach((l, k) => push(l, n, privItem || asStruct.privFlags[k]));
      continue;
    }
    // multi-line struct: `struct Name +D {` header, then one field per line
    const msHeader = line.startsWith("struct ")
      ? /^struct\s+(\w+(?:<[^{]*>)?)\s*(?:\+([\w,:\s]+?))?\s*\{\s*$/.exec(line.trim())
      : null;
    if (msHeader) {
      if (msHeader[2]) push(deriveAttr(msHeader[2]), n, privItem);
      push(`struct ${msHeader[1]} {`, n, privItem);
      inStructBody = true;
      continue;
    }
    if (inStructBody) {
      if (/^\}/.test(stripLiterals(line))) { inStructBody = false; push(line, n); continue; }
      if (/^#\[/.test(line.trim())) { push(line.trim(), n, privItem); continue; } // field attribute
      const fields = fieldsToRust(line.replace(/,\s*$/, ""));
      const anyPriv = fields.some((f) => f.priv);
      push(fields.map((f) => `${f.text},`).join(" "), n, anyPriv);
      continue;
    }
    const asConst = line.startsWith("const ") ? transformConst(line) : null;
    if (asConst) { for (const l of asConst) push(l, n, privItem); continue; }
    const asEnum = line.startsWith("enum ") ? transformEnumHeader(line) : null;
    if (asEnum) {
      for (const l of asEnum.lines) push(l, n, privItem);
      if (asEnum.open) { inEnumBody = true; enumDepth = 0; }
      continue;
    }
    if (inEnumBody) {
      const bare = stripLiterals(line);
      if (enumDepth === 0 && /^\}/.test(bare)) { inEnumBody = false; push(line, n); continue; }
      if (/^#\[/.test(line.trim())) { push(line.trim(), n, privItem); continue; } // variant attribute
      for (const ch of bare) {
        if (ch === "{") enumDepth++;
        else if (ch === "}") enumDepth--;
      }
      push(transformEnumVariant(line), n);
      continue;
    }
    // a macro invocation whose own delimiter stays open enters verbatim mode
    {
      const b = stripLiterals(line);
      if (!/^macro_rules!/.test(b.trim())) {
        const mre = /(^|[^\w!])\w+!\s*[({[]/g;
        let m;
        while ((m = mre.exec(b))) {
          let d = 0, i = m.index + m[0].length - 1;
          for (; i < b.length; i++) {
            const ch = b[i];
            if ("{([".includes(ch)) d++;
            else if ("})]".includes(ch)) d--;
            if (d === 0) { mre.lastIndex = i + 1; break; }
          }
          if (d > 0) { macroDepth = d; break; }
        }
      }
    }
    line = outsideStrings(line, (seg) => transformBindings(transformFnSigs(expandR(seg))));
    push(line, n, privItem);
  }

  // semicolon insertion with a block-context stack: a line before `}` is a tail
  // expression (no `;`) only when the block being closed is a value-returning fn
  // body; in unit fns and control-flow blocks a trailing statement gets `;`.
  const VALUE_CONTEXTS = ["fn-value", "let-block", "value-arm", "match-value"];
  const allBare = lines.map((l) => stripLiterals(l));
  // is the block opened at line i the tail expression of its parent (next line
  // after its closer starts with `}`)?
  const closesIntoTail = (i) => {
    let depth = 0;
    for (let j = i; j < allBare.length; j++) {
      for (const ch of allBare[j]) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (j > i && depth <= 0) return /^\}/.test(allBare[j + 1] ?? "");
    }
    return false;
  };
  // `x = if c { … }` / `x.y += match … {` — a top-level assignment whose value
  // is the opened block: its closer needs `;` and its tail is a value
  const topLevelAssign = (bare) => {
    if (/^(if|while|for|match|loop|else|return|pub|struct|enum|union|trait|impl|mod|async|unsafe|extern|static|const|type|where|use|let)\b/.test(bare)) return false;
    if (/\bfn\b/.test(bare)) return false;      // fn headers carry `Item = T` bindings
    let d = 0;
    for (let i = 0; i < bare.length - 1; i++) {
      const ch = bare[i];
      if ("([{<".includes(ch)) d++;              // `<` guards `Foo<Item = T>` bindings
      else if (")]}".includes(ch)) d = Math.max(0, d - 1);
      else if (ch === ">" && bare[i - 1] !== "-" && bare[i - 1] !== "=") d = Math.max(0, d - 1);
      else if (ch === "=" && d === 0) {
        const prev = bare[i - 1], next = bare[i + 1];
        if (next === "=" || next === ">") { i++; continue; }
        if (prev === "=" || prev === "!" || prev === "<" || prev === ">") continue;
        return true;
      }
    }
    return false;
  };
  const assignsValue = (bare) => /\{$/.test(bare) && topLevelAssign(bare);
  const blockContext = (bare, stack, i) => {
    // `} else {` / `} else if … {` closes and reopens the same construct —
    // the new block inherits the context of the one just closed
    if (/^\}/.test(bare) && /\{$/.test(bare)) return stack[stack.length - 1] ?? "other";
    if (/^macro_rules!/.test(bare)) return "macro-rules";
    // a macro arm `(pattern) => {` inside macro_rules — its closer needs `};`
    if (/=>\s*\{$/.test(bare) && stack[stack.length - 1] === "macro-rules") return "macro-arm";
    if (/^use\b/.test(bare)) return "use-block";         // multi-line `use x::{…}` closer needs `};`
    if (/^let\b/.test(bare) || assignsValue(bare)) return "let-block"; // let/assignment of a block expr needs `};`
    // lone `{`: opener of a multi-line signature (wrapped where clause) — scan
    // back past continuation lines to find the fn header
    if (/^\{$/.test(bare) && i !== undefined) {
      for (let k = i - 1; k >= 0 && k >= i - 12; k--) {
        const b = allBare[k];
        if (/[;{}]$/.test(b) || /^\}/.test(b)) break;
        if (/\bfn\b/.test(b)) return /->/.test(b) ? "fn-value" : "fn-unit";
      }
    }
    if (/\bfn\b[^{]*->/.test(bare)) return "fn-value";
    if (/^fn\b/.test(bare)) return "fn-unit";
    // a match-arm block in value position (`… => {`) produces a value iff its parent does
    if (/=>\s*\{$/.test(bare) && VALUE_CONTEXTS.includes(stack[stack.length - 1])) return "value-arm";
    // a multi-line `unsafe {` / `match … {` / `if … {` block that is the tail
    // expression of a value context produces that value
    if (/^(unsafe\s*|match\b[^{]*|if\b[^{]*|loop\s*)\{$/.test(bare) &&
        VALUE_CONTEXTS.includes(stack[stack.length - 1]) && i !== undefined && closesIntoTail(i)) {
      return /^match\b/.test(bare) ? "match-value" : "value-arm";
    }
    // a multi-line block opened in argument position (`spawn(async move {`,
    // `map(|x| {`) is an expression — its tail is a value
    {
      const opens = (bare.match(/\(/g) ?? []).length;
      const closes = (bare.match(/\)/g) ?? []).length;
      if (opens > closes && /\{$/.test(bare)) return "value-arm";
    }
    return "other";
  };

  const out = [];
  const stack = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (lineVerbatim[i]) {
      // macro-body token stream: no semicolon logic, but keep the stack balanced
      for (const ch of stripLiterals(line)) {
        if (ch === "{" || ch === "[") stack.push("other");
        else if (ch === "(") stack.push("paren");
        else if (ch === "}" || ch === "]" || ch === ")") stack.pop();
      }
      out.push(line);
      continue;
    }
    const bare = stripLiterals(line);
    const next = lines[i + 1];
    const nextBare = next === undefined ? undefined : stripLiterals(next);

    // simulate this line's push/pop sequence on a copy: `{`/`[` push a block context,
    // `(` pushes "paren"; closers pop. Records which contexts a net-closing line pops.
    const simulated = [...stack];
    const popped = [];
    const lineCtx = blockContext(bare, stack, i);
    for (const ch of bare) {
      if (ch === "{" || ch === "[") simulated.push(lineCtx);
      else if (ch === "(") simulated.push("paren");
      else if (ch === "}" || ch === "]" || ch === ")") popped.push(simulated.pop());
    }
    // contexts this line net-closes (beyond what it opened itself):
    const netClosed = stack.slice(simulated.length).reverse();
    const closesLetBlock = netClosed.includes("let-block") || netClosed.includes("macro-arm") || netClosed.includes("use-block");
    const closesParenStmt = netClosed.includes("paren");
    const topAfter = simulated[simulated.length - 1];

    let semi;
    if (line.endsWith(";") || line.endsWith(",")) semi = false;
    else if (/[[{(,;]$/.test(bare)) semi = false;                // opens a block / continues
    else if (/^[}\])]+[,;]?$/.test(bare)) {
      // pure closer: `;` when it terminates a let-binding, or a multi-line call
      // statement (`spawn(move || { … })`) that is not in value-tail position
      const valueTail = nextBare !== undefined && /^\}/.test(nextBare) && VALUE_CONTEXTS.includes(topAfter);
      semi = closesLetBlock || (closesParenStmt && !valueTail);
    }
    else if (/^#\[/.test(bare)) semi = false;                    // attribute
    else if (/^use\b/.test(bare)) semi = true;                   // in-body use statements (verbatim Rust)
    else if (stack[stack.length - 1] === "macro-rules" && /=>/.test(bare) && /\}$/.test(bare)) semi = true; // inline macro arm: `(p) => {…};`
    else if (!/^let\b/.test(bare) && /=>/.test(bare) && !/[[{(]$/.test(bare) &&
             bare.indexOf("=>") < (bare.indexOf("{") === -1 ? Infinity : bare.indexOf("{"))) semi = false; // match arm: `pat => …` (arrow before any block)
    else if (/[}\])]$/.test(bare) && (closesLetBlock || closesParenStmt)) {
      // closer with trailing text (`}).to_string()`): statement — unless it is
      // itself the tail expression of a value block
      const valueTail = nextBare !== undefined && /^\}/.test(nextBare) && VALUE_CONTEXTS.includes(topAfter);
      semi = !valueTail;
    }
    else if (/\}$/.test(bare)) semi = /^let\b/.test(bare) || topLevelAssign(bare); // inline `let x = … {…}` / `x.y = if … {…}`
    else if (/^fn\b/.test(bare) && !/\{/.test(bare)) semi = true; // trait method declaration
    else if (nextBare !== undefined && /^\}/.test(nextBare)) {
      semi = !VALUE_CONTEXTS.includes(stack[stack.length - 1]); // tail expr only in value blocks
    } else semi = true;

    out.push(semi ? line + ";" : line);

    stack.length = 0;
    stack.push(...simulated);
    if (process.env.TATAMUC_DEBUG_STACK) {
      console.error(`${String(i + 1).padStart(4)} semi=${semi ? 1 : 0} [${stack.join(",")}] ${line.slice(0, 60)}`);
    }
  }

  // use injection (auto-prelude + explicit #use directives)
  const body = out.join("\n");
  const uses = [...new Set([
    ...PRELUDE.filter(([re]) => re.test(body)).map(([, u]) => u),
    ...extraUses,
  ])].sort();
  const full = [...uses, ...(uses.length ? [""] : []), ...out];
  const fullSrc = [...uses.map(() => null), ...(uses.length ? [null] : []), ...lineSrc];
  const fullPriv = [...uses.map(() => false), ...(uses.length ? [false] : []), ...linePriv];

  // indentation by brace depth
  let depth = 0;
  const indented = full.map((line) => {
    const bare = stripLiterals(line);
    const opens = (bare.match(/[{([]/g) ?? []).length;
    const closes = (bare.match(/[})\]]/g) ?? []).length;
    const leading = /^[}\])]/.test(bare) ? 1 : 0;
    const d = Math.max(0, depth - leading);
    depth = Math.max(0, depth + opens - closes);
    return line === "" ? "" : "    ".repeat(d) + line;
  });

  return { rust: indented.join("\n") + "\n", map: fullSrc, privLines: new Set(fullPriv.flatMap((p, i) => (p ? [i] : []))) };
}

export function transpile(src) {
  return transpileMapped(src).rust;
}

// ---------- C header generation (--header): cbindgen-lite for extern "C" exports ----------

const C_TYPES = {
  i8: "int8_t", i16: "int16_t", i32: "int32_t", i64: "int64_t",
  u8: "uint8_t", u16: "uint16_t", u32: "uint32_t", u64: "uint64_t",
  f32: "float", f64: "double", bool: "bool",
  usize: "uintptr_t", isize: "intptr_t",
  "()": "void", "": "void",
  c_char: "char",
};

function cType(rustTy, structNames, warnings) {
  let t = rustTy.trim();
  let prefix = "", suffix = "";
  while (true) {
    if (t.startsWith("*const ")) { t = t.slice(7).trim(); suffix += "*"; prefix = "const "; continue; }
    if (t.startsWith("*mut ")) { t = t.slice(5).trim(); suffix += "*"; continue; }
    break;
  }
  const base = C_TYPES[t] ?? (structNames.has(t) ? t : null);
  if (base === null) {
    warnings.push(`unmapped type: ${rustTy}`);
    return `/* unmapped: ${rustTy} */ void${suffix ? " " + suffix : ""}`;
  }
  return `${prefix}${base}${suffix ? " " + suffix : ""}`;
}

// shared C-ABI surface parser: #[repr(C)] structs, fieldless #[repr(C)] enums,
// and #[no_mangle] extern "C" fns
export function parseCAbi(rust) {
  const lines = rust.split("\n");
  const structs = []; // {name, fields: [[type, fname]]}
  const structNames = new Set();
  const enums = []; // fieldless: {name, variants: [[vname, value]]}
  const dataEnums = []; // payload-carrying: {name, variants: [{name, value, fields: [[type, fname]]}]}
  const dataEnumNames = new Set();
  const enumNames = new Set();
  for (let i = 0; i < lines.length; i++) {
    // #[repr(C)] or #[repr(C, i32)] (int repr is required by Rust for data enums
    // with explicit discriminants; only 32-bit tags are supported by the bindings)
    const reprM = /^\s*#\[repr\(C(?:\s*,\s*(\w+))?\)\]/.exec(lines[i]);
    if (!reprM) continue;
    if (reprM[1] && reprM[1] !== "i32" && reprM[1] !== "u32") continue; // unsupported tag width
    let j = i + 1;
    while (j < lines.length && /^\s*#\[/.test(lines[j])) j++;
    const em = /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)\s*\{(.*)$/.exec(lines[j] ?? "");
    if (em) {
      // collect the body (inline `{A, B}` or one variant per following line)
      let body = em[2].replace(/\}\s*;?\s*$/, "");
      if (!/\}/.test(em[2])) {
        for (j++; j < lines.length && !/^\s*\}/.test(lines[j]); j++) body += " " + lines[j];
      }
      // split variants on top-level commas (payloads contain commas of their own)
      const parts = [];
      let depth = 0, cur = "";
      for (const ch of body) {
        if (ch === "(" || ch === "{") depth++;
        else if (ch === ")" || ch === "}") depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; }
        else cur += ch;
      }
      parts.push(cur);
      const variants = [];
      let next = 0;
      let hasPayload = false;
      let unparseable = false;
      for (const v of parts.map((v) => v.trim()).filter(Boolean)) {
        let m2;
        if ((m2 = /^([A-Za-z_]\w*)\s*\(([^)]*)\)(?:\s*=\s*(-?\d+))?$/.exec(v))) {
          hasPayload = true;
          const fields = m2[2].split(/,(?![^<[]*[>\]])/).map((t, i) => [t.trim(), `_${i}`]).filter(([t]) => t);
          const val = m2[3] !== undefined ? parseInt(m2[3], 10) : next;
          variants.push({ name: m2[1], value: val, fields });
          next = val + 1;
        } else if ((m2 = /^([A-Za-z_]\w*)\s*\{([^}]*)\}(?:\s*=\s*(-?\d+))?$/.exec(v))) {
          hasPayload = true;
          const fields = m2[2].split(/,(?![^<[]*[>\]])/).map((f) => {
            const fm = /^([A-Za-z_]\w*):\s*(.+)$/.exec(f.trim());
            return fm ? [fm[2].trim(), fm[1]] : null;
          }).filter(Boolean);
          const val = m2[3] !== undefined ? parseInt(m2[3], 10) : next;
          variants.push({ name: m2[1], value: val, fields });
          next = val + 1;
        } else if ((m2 = /^([A-Za-z_]\w*)(?:\s*=\s*(-?\d+))?$/.exec(v))) {
          const val = m2[2] !== undefined ? parseInt(m2[2], 10) : next;
          variants.push({ name: m2[1], value: val, fields: [] });
          next = val + 1;
        } else { unparseable = true; break; }
      }
      if (!unparseable && variants.length) {
        if (hasPayload) {
          dataEnumNames.add(em[1]);
          dataEnums.push({ name: em[1], variants });
        } else {
          enumNames.add(em[1]);
          enums.push({ name: em[1], variants: variants.map((v) => [v.name, v.value]) });
        }
      }
      continue;
    }
    const m = /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/.exec(lines[j] ?? "");
    if (!m) continue;
    structNames.add(m[1]);
    const fields = [];
    for (j++; j < lines.length && !/^\s*\}/.test(lines[j]); j++) {
      const fm = /^\s*(?:pub\s+)?([A-Za-z_]\w*):\s*(.+?),?\s*$/.exec(lines[j]);
      if (fm) fields.push([fm[2], fm[1]]);
    }
    structs.push({ name: m[1], fields });
  }

  const fns = [];
  const re = /#\[no_mangle\]\s*\n\s*(?:pub\s+)?extern\s+"C"\s+fn\s+([A-Za-z_]\w*)\(([^)]*)\)(?:\s*->\s*([^{\n]+))?/g;
  let m;
  while ((m = re.exec(rust)) !== null) {
    const params = m[2].split(/,(?![^<(]*[>)])/).map((p) => p.trim()).filter(Boolean).map((p) => {
      const pm = /^(?:mut\s+)?([A-Za-z_]\w*):\s*(.+)$/.exec(p);
      return pm ? [pm[2], pm[1]] : [p, ""];
    });
    fns.push({ name: m[1], params, ret: (m[3] ?? "").trim() });
  }
  return { structs, structNames, enums, enumNames, dataEnums, dataEnumNames, fns };
}

const ARRAY_TY = /^\[(.+);\s*(\d+)\]$/;

export function generateHeader(rust, crateName) {
  const warnings = [];
  const { structs, structNames, enums, enumNames, dataEnums, dataEnumNames, fns } = parseCAbi(rust);
  const scalarNames = new Set([...structNames, ...enumNames, ...dataEnumNames]);

  const guard = `${crateName.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_H`;
  const out = [];
  out.push(`/* Generated by tatamuc from ${crateName} — do not edit. */`);
  out.push(`#ifndef ${guard}`, `#define ${guard}`, "");
  out.push("#include <stdint.h>", "#include <stdbool.h>", "");
  out.push("#ifdef __cplusplus", 'extern "C" {', "#endif", "");
  // C requires a struct to be declared before use — emit in dependency order
  const ordered = [];
  const visited = new Set();
  const visit = (s) => {
    if (visited.has(s.name)) return;
    visited.add(s.name);
    for (const [ty] of s.fields) {
      const base = ARRAY_TY.exec(ty.trim())?.[1]?.trim() ?? ty.trim();
      const dep = structs.find((x) => x.name === base);
      if (dep) visit(dep);
    }
    ordered.push(s);
  };
  // fieldless enums first (variant names prefixed to avoid C namespace collisions)
  for (const e of enums) {
    out.push(`typedef enum {`);
    for (const [vname, val] of e.variants) out.push(`    ${e.name}_${vname} = ${val},`);
    out.push(`} ${e.name};`, "");
  }
  structs.forEach(visit);
  for (const s of ordered) {
    out.push(`typedef struct {`);
    for (const [ty, name] of s.fields) {
      const am = ARRAY_TY.exec(ty.trim());
      if (am) out.push(`    ${cType(am[1].trim(), scalarNames, warnings)} ${name}[${am[2]}];`);
      else out.push(`    ${cType(ty, scalarNames, warnings)} ${name};`);
    }
    out.push(`} ${s.name};`, "");
  }
  // data-carrying repr(C) enums: tag + union of variant structs (RFC 2195 layout)
  for (const e of dataEnums) {
    out.push(`typedef enum {`);
    for (const v of e.variants) out.push(`    ${e.name}_${v.name} = ${v.value},`);
    out.push(`} ${e.name}Tag;`, "");
    out.push(`typedef struct {`, `    ${e.name}Tag tag;`, `    union {`);
    for (const v of e.variants) {
      if (!v.fields.length) continue;
      const fs = v.fields.map(([ty, fname]) => {
        const am = ARRAY_TY.exec(ty.trim());
        return am ? `${cType(am[1].trim(), scalarNames, warnings)} ${fname}[${am[2]}];`
                  : `${cType(ty, scalarNames, warnings)} ${fname};`;
      }).join(" ");
      out.push(`        struct { ${fs} } ${v.name};`);
    }
    out.push(`    } payload;`, `} ${e.name};`, "");
  }
  for (const f of fns) {
    const params = f.params.length
      ? f.params.map(([ty, name]) => `${cType(ty, scalarNames, warnings)} ${name}`.trim()).join(", ")
      : "void";
    out.push(`${cType(f.ret, scalarNames, warnings)} ${f.name}(${params});`);
  }
  out.push("", "#ifdef __cplusplus", "}", "#endif", "", `#endif /* ${guard} */`, "");
  return { header: out.join("\n"), warnings, exports: fns.length, structs: structs.length };
}

// ---------- JS binding generation (--jsbind): jsbindgen-lite for wasm consumers ----------
//
// Emits an ES module wrapping the wasm exports: typed struct marshalling (repr(C)
// layout on wasm32), string helpers over the *_alloc/*_free protocol, and per-export
// methods that convert 64-bit integer arguments to BigInt.

const WASM32_LAYOUT = {
  i8: 1, u8: 1, bool: 1, i16: 2, u16: 2,
  i32: 4, u32: 4, f32: 4, usize: 4, isize: 4,
  i64: 8, u64: 8, f64: 8,
};
const BIGINT_TYPES = new Set(["i64", "u64"]);

export function generateJsBinding(rust, crateName) {
  const warnings = [];
  const { structs, enums, enumNames, dataEnums, dataEnumNames, fns } = parseCAbi(rust);

  // resolve layouts recursively: nested structs, [T; N] arrays, fieldless enums (i32),
  // and data-carrying repr(C) enums (tag i32 + aligned union payload)
  const defs = Object.fromEntries(structs.map((s) => [s.name, s]));
  const dataDefs = Object.fromEntries(dataEnums.map((e) => [e.name, e]));
  const layouts = {};
  const dataLayouts = {};
  const sizeAlignOf = (t, stack) => {
    if (WASM32_LAYOUT[t] !== undefined) return { size: WASM32_LAYOUT[t], align: WASM32_LAYOUT[t] };
    if (enumNames.has(t)) return { size: 4, align: 4 }; // repr(C) fieldless enum = C int
    if (dataEnumNames.has(t)) {
      const de = dataEnumLayoutOf(t, stack);
      return de && { size: de.size, align: de.align };
    }
    const am = ARRAY_TY.exec(t);
    if (am) {
      const el = sizeAlignOf(am[1].trim(), stack);
      return el && { size: el.size * parseInt(am[2], 10), align: el.align };
    }
    const sub = layoutOf(t, stack);
    return sub && { size: sub.size, align: sub.align };
  };
  const dataEnumLayoutOf = (name, stack = []) => {
    if (dataLayouts[name] !== undefined) return dataLayouts[name];
    if (stack.includes(name)) { warnings.push(`recursive enum by value: ${name}`); return (dataLayouts[name] = null); }
    const e = dataDefs[name];
    if (!e) return (dataLayouts[name] = null);
    let payloadAlign = 1, maxVariant = 0;
    const variants = {};
    for (const v of e.variants) {
      let off = 0, vAlign = 1;
      const fields = [];
      for (const [ty, fname] of v.fields) {
        const t = ty.trim();
        const sa = sizeAlignOf(t, [...stack, name]);
        if (!sa) { warnings.push(`${name}::${v.name}.${fname}: unmapped field type ${ty}`); return (dataLayouts[name] = null); }
        off = Math.ceil(off / sa.align) * sa.align;
        const am = ARRAY_TY.exec(t);
        fields.push([fname, am ? `${am[1].trim()}[${am[2]}]` : t, off]);
        off += sa.size;
        vAlign = Math.max(vAlign, sa.align);
      }
      variants[v.name] = fields;
      payloadAlign = Math.max(payloadAlign, vAlign);
      maxVariant = Math.max(maxVariant, Math.ceil(off / vAlign) * vAlign);
    }
    const payloadOffset = Math.ceil(4 / payloadAlign) * payloadAlign;
    const align = Math.max(4, payloadAlign);
    const size = Math.ceil((payloadOffset + maxVariant) / align) * align;
    const byTag = Object.fromEntries(e.variants.map((v) => [v.value, v.name]));
    const tags = Object.fromEntries(e.variants.map((v) => [v.name, v.value]));
    return (dataLayouts[name] = { size, align, payloadOffset, byTag, tags, variants });
  };
  for (const e of dataEnums) dataEnumLayoutOf(e.name);
  const layoutOf = (name, stack = []) => {
    if (layouts[name] !== undefined) return layouts[name];
    if (stack.includes(name)) { warnings.push(`recursive struct by value: ${name}`); return (layouts[name] = null); }
    const s = defs[name];
    if (!s) return (layouts[name] = null);
    let off = 0, maxAlign = 1;
    const fields = [];
    for (const [ty, fname] of s.fields) {
      const t = ty.trim();
      const sa = sizeAlignOf(t, [...stack, name]);
      if (!sa) { warnings.push(`${name}.${fname}: unmapped field type ${ty}`); return (layouts[name] = null); }
      off = Math.ceil(off / sa.align) * sa.align;
      // arrays are encoded as "El[N]" in the descriptor for the runtime marshaller
      const am = ARRAY_TY.exec(t);
      fields.push([fname, am ? `${am[1].trim()}[${am[2]}]` : t, off]);
      off += sa.size;
      maxAlign = Math.max(maxAlign, sa.align);
    }
    const size = Math.ceil(off / maxAlign) * maxAlign;
    return (layouts[name] = { size, align: maxAlign, fields });
  };
  const structDefs = [];
  for (const s of structs) {
    const l = layoutOf(s.name);
    if (!l) continue;
    const fields = l.fields.map(([n, t, off]) => `["${n}", "${t}", ${off}]`);
    structDefs.push(`  ${s.name}: { size: ${l.size}, align: ${l.align}, fields: [${fields.join(", ")}] },`);
  }

  const allocFn = fns.find((f) => f.name.endsWith("_alloc"))?.name;
  const freeFn = fns.find((f) => f.name.endsWith("_free"))?.name;

  const methods = fns.map((f) => {
    const args = f.params.map(([, n], i) => n || `a${i}`);
    const conv = f.params.map(([ty], i) => (BIGINT_TYPES.has(ty.trim()) ? `BigInt(${args[i]})` : args[i]));
    return `  ${f.name}(${args.join(", ")}) { return this.exports.${f.name}(${conv.join(", ")}); }`;
  });

  const className = crateName.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join("");

  return {
    warnings,
    exports: fns.length,
    binding: `/* Generated by tatamuc from ${crateName} — do not edit. */
const FIELD = {
  i8:  { get: (v, p) => v.getInt8(p),          set: (v, p, x) => v.setInt8(p, x) },
  u8:  { get: (v, p) => v.getUint8(p),         set: (v, p, x) => v.setUint8(p, x) },
  bool:{ get: (v, p) => v.getUint8(p) !== 0,   set: (v, p, x) => v.setUint8(p, x ? 1 : 0) },
  i16: { get: (v, p) => v.getInt16(p, true),   set: (v, p, x) => v.setInt16(p, x, true) },
  u16: { get: (v, p) => v.getUint16(p, true),  set: (v, p, x) => v.setUint16(p, x, true) },
  i32: { get: (v, p) => v.getInt32(p, true),   set: (v, p, x) => v.setInt32(p, x, true) },
  u32: { get: (v, p) => v.getUint32(p, true),  set: (v, p, x) => v.setUint32(p, x, true) },
  usize:{ get: (v, p) => v.getUint32(p, true), set: (v, p, x) => v.setUint32(p, x, true) },
  isize:{ get: (v, p) => v.getInt32(p, true),  set: (v, p, x) => v.setInt32(p, x, true) },
  f32: { get: (v, p) => v.getFloat32(p, true), set: (v, p, x) => v.setFloat32(p, x, true) },
  f64: { get: (v, p) => v.getFloat64(p, true), set: (v, p, x) => v.setFloat64(p, x, true) },
  i64: { get: (v, p) => v.getBigInt64(p, true),  set: (v, p, x) => v.setBigInt64(p, BigInt(x), true) },
  u64: { get: (v, p) => v.getBigUint64(p, true), set: (v, p, x) => v.setBigUint64(p, BigInt(x), true) },
};

const SIZES = { i8: 1, u8: 1, bool: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, usize: 4, isize: 4, i64: 8, u64: 8, f64: 8 };
const ENUMS = new Set([${enums.map((e) => `"${e.name}"`).join(", ")}]);
const ARR = /^(.+)\\[(\\d+)\\]$/;

export const structs = {
${structDefs.join("\n")}
};

export const dataEnums = {
${dataEnums.filter((e) => dataLayouts[e.name]).map((e) => `  ${e.name}: ${JSON.stringify(dataLayouts[e.name])},`).join("\n")}
};
${enums.map((e) => `
export const ${e.name} = Object.freeze({ ${e.variants.map(([v, n]) => `${v}: ${n}`).join(", ")} });`).join("")}

export async function load(bytes, imports = {}) {
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  return new ${className}(instance);
}

export class ${className} {
  constructor(instance) { this.instance = instance; this.exports = instance.exports; }
  get view() { return new DataView(this.exports.memory.buffer); }
  get mem() { return new Uint8Array(this.exports.memory.buffer); }
${allocFn
  ? `  alloc(len) { return Number(this.exports.${allocFn}(len)); }
  free(ptr, cap) { this.exports.${freeFn ?? "MISSING_free"}(ptr, cap); }`
  : `  alloc() { throw new Error("no *_alloc export in this module"); }
  free() { throw new Error("no *_free export in this module"); }`}
  writeString(s) {
    const b = new TextEncoder().encode(s);
    const ptr = this.alloc(b.length);
    this.mem.set(b, ptr);
    return { ptr, len: b.length };
  }
  readString(ptr, len) { return new TextDecoder().decode(this.mem.slice(ptr, ptr + len)); }
  unpackString(packed) {
    const ptr = Number(packed >> 32n), len = Number(packed & 0xffffffffn);
    const s = this.readString(ptr, len);
    this.free(ptr, len);
    return s;
  }
  allocStruct(desc, value) {
    const ptr = this.alloc(desc.size);
    if (value !== undefined) this.writeStruct(desc, ptr, value);
    return ptr;
  }
  sizeOf(t) {
    const am = ARR.exec(t);
    if (am) return this.sizeOf(am[1]) * Number(am[2]);
    return SIZES[t] ?? (ENUMS.has(t) ? 4 : (dataEnums[t] ?? structs[t]).size);
  }
  readValue(t, ptr) {
    const am = ARR.exec(t);
    if (am) {
      const stride = this.sizeOf(am[1]);
      return Array.from({ length: Number(am[2]) }, (_, i) => this.readValue(am[1], ptr + i * stride));
    }
    if (ENUMS.has(t)) return this.view.getInt32(ptr, true);
    if (FIELD[t]) return FIELD[t].get(this.view, ptr);
    if (dataEnums[t]) return this.readStruct(dataEnums[t], ptr);
    return this.readStruct(structs[t], ptr);
  }
  writeValue(t, ptr, x) {
    const am = ARR.exec(t);
    if (am) {
      const stride = this.sizeOf(am[1]);
      for (let i = 0; i < Number(am[2]); i++) this.writeValue(am[1], ptr + i * stride, x[i]);
      return;
    }
    if (ENUMS.has(t)) { this.view.setInt32(ptr, x, true); return; }
    if (FIELD[t]) { FIELD[t].set(this.view, ptr, x); return; }
    this.writeStruct(dataEnums[t] ?? structs[t], ptr, x);
  }
  readStruct(desc, ptr) {
    if (desc.variants) {
      // data enum: tag i32, then the active variant's payload
      const kind = desc.byTag[this.view.getInt32(ptr, true)];
      const o = { kind };
      for (const [n, t, off] of desc.variants[kind] ?? []) o[n] = this.readValue(t, ptr + desc.payloadOffset + off);
      return o;
    }
    const o = {};
    for (const [n, t, off] of desc.fields) o[n] = this.readValue(t, ptr + off);
    return o;
  }
  writeStruct(desc, ptr, value) {
    if (desc.variants) {
      this.view.setInt32(ptr, desc.tags[value.kind], true);
      for (const [n, t, off] of desc.variants[value.kind] ?? []) this.writeValue(t, ptr + desc.payloadOffset + off, value[n]);
      return;
    }
    for (const [n, t, off] of desc.fields) this.writeValue(t, ptr + off, value[n]);
  }
  freeStruct(desc, ptr) { this.free(ptr, desc.size); }
${methods.join("\n")}
}
`,
  };
}

// ---------- Dart FFI binding generation (--dartbind): for Flutter / dart:ffi ----------
//
// Emits a Dart class wrapping the C ABI exports: lookupFunction pairs for every
// #[no_mangle] extern "C" fn plus string helpers over the *_alloc/*_free protocol.
// Struct marshalling is not yet generated (pass structs by pointer + manual layout).

const DART_NATIVE = {
  i8: "Int8", u8: "Uint8", i16: "Int16", u16: "Uint16",
  i32: "Int32", u32: "Uint32", i64: "Int64", u64: "Uint64",
  f32: "Float", f64: "Double", usize: "UintPtr", isize: "IntPtr",
  bool: "Bool", "()": "Void", "": "Void",
};
const DART_VIEW = {
  Int8: "int", Uint8: "int", Int16: "int", Uint16: "int",
  Int32: "int", Uint32: "int", Int64: "int", Uint64: "int",
  Float: "double", Double: "double", UintPtr: "int", IntPtr: "int",
  Bool: "bool", Void: "void",
};

export function generateDartBinding(rust, crateName) {
  const warnings = [];
  const { fns } = parseCAbi(rust);

  const nativeTy = (ty) => {
    const t = ty.trim();
    const pm = /^\*(?:const|mut)\s+(\w+)$/.exec(t);
    if (pm && DART_NATIVE[pm[1]] && DART_NATIVE[pm[1]] !== "Void") return `Pointer<${DART_NATIVE[pm[1]]}>`;
    if (/^\*(const|mut)\s/.test(t)) return "Pointer<Void>";
    return DART_NATIVE[t] ?? null;
  };
  const dartTy = (n) => (n.startsWith("Pointer") ? n : DART_VIEW[n]);

  const className = crateName.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  const allocFn = fns.find((f) => f.name.endsWith("_alloc"))?.name;
  const freeFn = fns.find((f) => f.name.endsWith("_free"))?.name;

  const members = [];
  for (const f of fns) {
    const pn = f.params.map(([ty]) => nativeTy(ty));
    const rn = nativeTy(f.ret) ?? DART_NATIVE[f.ret.trim()] ?? null;
    if (pn.includes(null) || rn === null) {
      warnings.push(`${f.name}: skipped (unmapped type)`);
      continue;
    }
    const argNames = f.params.map(([, n], i) => n || `a${i}`);
    members.push(
      `  late final ${f.name} = _lib.lookupFunction<` +
      `${rn} Function(${pn.join(", ")}), ` +
      `${dartTy(rn)} Function(${pn.map(dartTy).join(", ")})>('${f.name}');`
    );
  }

  const binding = `// Generated by tatamuc from ${crateName} — do not edit.
// ignore_for_file: non_constant_identifier_names
import 'dart:convert';
import 'dart:ffi';

class ${className} {
  final DynamicLibrary _lib;
  ${className}(this._lib);

  /// Load from a dynamic library file (Android .so, desktop .dylib/.dll).
  factory ${className}.open(String path) => ${className}(DynamicLibrary.open(path));

  /// Use symbols linked into the process (iOS static lib / XCFramework).
  factory ${className}.process() => ${className}(DynamicLibrary.process());

${members.join("\n")}
${allocFn ? `
  ({Pointer<Uint8> ptr, int len}) writeString(String s) {
    final bytes = utf8.encode(s);
    final ptr = ${allocFn}(bytes.length);
    ptr.asTypedList(bytes.length).setAll(0, bytes);
    return (ptr: ptr, len: bytes.length);
  }

  String readString(Pointer<Uint8> ptr, int len) => utf8.decode(ptr.asTypedList(len));

  /// Read a returned (ptr, out_len) string and free the buffer.
  /// Pair this with exports of the form: \`fn f(...) -> *mut u8\` + \`out_len *mut usize\`.
  String takeString(Pointer<Uint8> ptr, int len) {
    final s = readString(ptr, len);
    ${freeFn ?? "MISSING_free"}(ptr, len);
    return s;
  }

  /// Allocate scratch space for an out-param (e.g. \`out_len *mut usize\`).
  Pointer<UintPtr> allocLenSlot() => ${allocFn}(sizeOf<UintPtr>()).cast<UintPtr>();

  /// Read a usize out-param. Pointer<UintPtr> has no direct .value extension,
  /// so read as Uint64 (all supported ABIs — arm64 / x86_64 — are 64-bit).
  int readLenSlot(Pointer<UintPtr> p) => p.cast<Uint64>().value;

  void freeLenSlot(Pointer<UintPtr> p) => ${freeFn ?? "MISSING_free"}(p.cast<Uint8>(), sizeOf<UintPtr>());` : ""}
}
`;
  return { binding, warnings, exports: members.length };
}

// ---------- TypeScript declarations (--dts): typed surface for the JS binding ----------

const TS_SCALAR = {
  i8: "number", u8: "number", i16: "number", u16: "number",
  i32: "number", u32: "number", f32: "number", f64: "number",
  usize: "number", isize: "number", bool: "boolean",
  i64: "bigint", u64: "bigint",
};

export function generateDts(rust, crateName) {
  const warnings = [];
  const { structs, structNames, enums, enumNames, dataEnums, dataEnumNames, fns } = parseCAbi(rust);

  const tsField = (ty) => {
    const t = ty.trim();
    const am = ARRAY_TY.exec(t);
    if (am) {
      const el = tsField(am[1].trim());
      const n = parseInt(am[2], 10);
      return n <= 16 ? `[${Array(n).fill(el).join(", ")}]` : `${el}[]`; // fixed-length tuple
    }
    if (TS_SCALAR[t]) return TS_SCALAR[t];
    if (structNames.has(t) || enumNames.has(t) || dataEnumNames.has(t)) return t;
    warnings.push(`unmapped field type: ${ty}`);
    return "unknown";
  };
  const tsParam = (ty) => {
    const t = ty.trim();
    if (/^\*(const|mut)\s/.test(t)) return "number";              // pointer = wasm32 address
    if (t === "i64" || t === "u64") return "number | bigint";     // wrapper BigInt()s it
    if (TS_SCALAR[t]) return TS_SCALAR[t];
    if (enumNames.has(t)) return t;
    if (structNames.has(t)) { warnings.push(`${t} passed by value — ABI-dependent in wasm; prefer pointers`); return "number"; }
    warnings.push(`unmapped param type: ${t}`);
    return "unknown";
  };
  const tsRet = (ty) => {
    const t = ty.trim();
    if (t === "" || t === "()") return "void";
    if (/^\*(const|mut)\s/.test(t)) return "number";
    if (TS_SCALAR[t]) return TS_SCALAR[t];
    if (enumNames.has(t)) return t;
    warnings.push(`unmapped return type: ${t}`);
    return "unknown";
  };

  const className = crateName.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join("");

  const out = [];
  out.push(`/* Generated by tatamuc from ${crateName} — do not edit. */`);
  out.push("");
  for (const e of enums) {
    out.push(`export declare const ${e.name}: { ${e.variants.map(([v, n]) => `readonly ${v}: ${n}`).join("; ")} };`);
    out.push(`export type ${e.name} = typeof ${e.name}[keyof typeof ${e.name}];`, "");
  }
  // data-carrying enums as discriminated unions
  for (const e of dataEnums) {
    out.push(`export type ${e.name} =`);
    e.variants.forEach((v, i) => {
      const fields = v.fields.map(([ty, fname]) => `; ${fname}: ${tsField(ty.trim())}`).join("");
      out.push(`  | { kind: "${v.name}"${fields} }${i === e.variants.length - 1 ? ";" : ""}`);
    });
    out.push("");
  }
  for (const s of structs) {
    out.push(`export interface ${s.name} {`);
    for (const [ty, name] of s.fields) out.push(`  ${name}: ${tsField(ty.trim())};`);
    out.push(`}`, "");
  }
  out.push(`export interface StructDesc<T> {`);
  out.push(`  size: number;`);
  out.push(`  align: number;`);
  out.push(`  fields: [string, string, number][];`);
  out.push(`  readonly __type?: T;`);
  out.push(`}`, "");
  out.push(`export const structs: {`);
  for (const s of structs) out.push(`  ${s.name}: StructDesc<${s.name}>;`);
  out.push(`};`, "");
  out.push(`export const dataEnums: {`);
  for (const e of dataEnums) out.push(`  ${e.name}: StructDesc<${e.name}>;`);
  out.push(`};`, "");
  out.push(`export class ${className} {`);
  out.push(`  constructor(instance: WebAssembly.Instance);`);
  out.push(`  readonly instance: WebAssembly.Instance;`);
  out.push(`  readonly exports: WebAssembly.Exports;`);
  out.push(`  readonly view: DataView;`);
  out.push(`  readonly mem: Uint8Array;`);
  out.push(`  alloc(len: number): number;`);
  out.push(`  free(ptr: number, cap: number): void;`);
  out.push(`  writeString(s: string): { ptr: number; len: number };`);
  out.push(`  readString(ptr: number, len: number): string;`);
  out.push(`  unpackString(packed: bigint): string;`);
  out.push(`  allocStruct<T>(desc: StructDesc<T>, value?: T): number;`);
  out.push(`  readStruct<T>(desc: StructDesc<T>, ptr: number): T;`);
  out.push(`  writeStruct<T>(desc: StructDesc<T>, ptr: number, value: T): void;`);
  out.push(`  freeStruct(desc: StructDesc<unknown>, ptr: number): void;`);
  for (const f of fns) {
    const params = f.params.map(([ty, n], i) => `${n || `a${i}`}: ${tsParam(ty)}`).join(", ");
    out.push(`  ${f.name}(${params}): ${tsRet(f.ret)};`);
  }
  out.push(`}`, "");
  out.push(`export function load(bytes: BufferSource, imports?: WebAssembly.Imports): Promise<${className}>;`);
  out.push("");
  return { dts: out.join("\n"), warnings, exports: fns.length };
}

// ---------- out-of-band docs (--docs): sidecar .doc.md → /// comments on expansion ----------
//
// Sidecar format: an optional intro (becomes //! module docs), then `## <item>`
// sections whose bodies become /// doc comments on the item with that name.
// Anchoring is by item NAME, not line number, so docs survive edits to the code.

export function mergeDocs(rust, sidecarMd) {
  const sections = { "": [] };
  let current = "";
  for (const line of sidecarMd.split("\n")) {
    const h = /^##\s+(?:`)?([A-Za-z_]\w*)(?:`)?\s*$/.exec(line);
    if (h) { current = h[1]; sections[current] = []; continue; }
    if (/^#\s/.test(line)) continue; // top-level title
    (sections[current] ??= []).push(line);
  }
  const trim = (ls) => {
    ls = ls.filter((l) => !INLINE_ENTRY.test(l.trim())); // ledger entries are not doc text
    while (ls.length && ls[0].trim() === "") ls.shift();
    // a leading backtick line is the recorded signature (doc-freshness metadata), not doc text
    if (ls.length && /^`.+`$/.test(ls[0].trim())) ls.shift();
    while (ls.length && ls[0].trim() === "") ls.shift();
    while (ls.length && ls[ls.length - 1].trim() === "") ls.pop();
    return ls;
  };

  const lines = rust.split("\n");
  const out = [];
  const moduleDoc = trim(sections[""]);
  if (moduleDoc.length) out.push(...moduleDoc.map((l) => `//! ${l}`.trimEnd()), "");

  const done = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(\s*)(?:pub\s+)?(?:fn|struct|enum|trait|const)\s+([A-Za-z_]\w*)/.exec(line);
    if (m && sections[m[2]] && !done.has(m[2])) {
      done.add(m[2]);
      const doc = trim([...sections[m[2]]]);
      // place docs above a directly-preceding attribute line (e.g. #[derive])
      let insertAt = out.length;
      while (insertAt > 0 && /^\s*#\[/.test(out[insertAt - 1])) insertAt--;
      out.splice(insertAt, 0, ...doc.map((l) => `${m[1]}/// ${l}`.trimEnd()));
    }
    out.push(line);
  }
  return out.join("\n");
}

// ---------- doc freshness (--doc-check / --doc-sync): sidecar drift detection ----------
//
// A sidecar section may record the item's signature as a leading backtick line:
//   ## parse
//   `fn parse(text &str) R<Config>`
//   <doc body...>
// --doc-check compares recorded signatures against the current code and reports
// orphaned sections, undocumented items, and stale signatures. --doc-sync updates
// recorded signatures and appends stub sections for undocumented items.

function topLevelItems(ttmSrc) {
  const items = []; // {name, kind, sig, line}
  let depth = 0;
  ttmSrc.split("\n").forEach((raw, idx) => {
    const bare = stripLiterals(raw.trim());
    if (depth <= 1) {
      const m = /^(?:#\[[^\]]*\]\s*)?(?:priv\s+)?(?:async\s+)?(fn|struct|enum|trait|const)\s+([A-Za-z_]\w*)/.exec(bare);
      if (m && !/^#\[/.test(bare) && (depth === 0 || m[1] === "fn")) {
        // for fn/trait the body is noise; for struct/enum the braces ARE the signature
        const sig = (m[1] === "fn" || m[1] === "trait")
          ? raw.trim().replace(/\s*\{.*$/, "").trim()
          : raw.trim().replace(/\s*\{\s*$/, "").trim();
        items.push({ name: m[2], kind: m[1], sig, line: idx + 1 });
      }
    }
    for (const ch of bare) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  });
  return items;
}

// inline-comment ledger entry: `~ above \`anchor\`: text` / `~ tail \`anchor\`: text`
const INLINE_ENTRY = /^~\s+(above|tail)\s+`([^`]+)`(?:#(\d+))?:\s?(.*)$/;

function parseSidecar(md) {
  const intro = [];
  const sections = {}; // name -> {sig, body: [...], inline: [{kind, anchor, text}]}
  const order = [];
  let current = null;
  for (const line of md.split("\n")) {
    const h = /^##\s+(?:`)?([A-Za-z_]\w*)(?:`)?\s*$/.exec(line);
    if (h) { current = h[1]; sections[current] = { sig: null, body: [], inline: [] }; order.push(current); continue; }
    if (current === null) { intro.push(line); continue; }
    const s = sections[current];
    const inl = INLINE_ENTRY.exec(line.trim());
    if (inl) { s.inline.push({ kind: inl[1], anchor: inl[2], nth: inl[3] ? parseInt(inl[3], 10) : 1, text: inl[4] }); continue; }
    const sigLine = /^`(.+)`\s*$/.exec(line.trim());
    if (sigLine && s.sig === null && s.body.every((b) => b.trim() === "")) { s.sig = sigLine[1]; continue; }
    s.body.push(line);
  }
  return { intro, sections, order };
}

// re-insert ledgered inline comments into generated Rust, using the .ttm line map
export function attachInlineComments(rust, map, ttmSrc, sidecarMd) {
  const { sections } = parseSidecar(sidecarMd);
  const srcLines = ttmSrc.split("\n").map((l) => l.trim());
  const nthIndexOf = (arr, text, nth) => {
    let seen = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] === text && ++seen === nth) return i;
    return -1;
  };
  const rustLines = rust.split("\n");
  const byIdx = new Map(); // rust line idx -> {above: [], tail: []}
  for (const sec of Object.values(sections)) {
    for (const e of sec.inline) {
      const srcNo = nthIndexOf(srcLines, e.anchor, e.nth ?? 1) + 1;
      if (srcNo === 0) continue; // orphan — surfaced by --doc-check
      const outIdx = map.indexOf(srcNo);
      if (outIdx === -1) continue;
      const slot = byIdx.get(outIdx) ?? { above: [], tail: [] };
      slot[e.kind === "tail" ? "tail" : "above"].push(e.text);
      byIdx.set(outIdx, slot);
    }
  }
  for (const idx of [...byIdx.keys()].sort((a, b) => b - a)) {
    const { above, tail } = byIdx.get(idx);
    if (tail.length) rustLines[idx] += ` // ${tail.join("; ")}`;
    if (above.length) {
      const indent = /^\s*/.exec(rustLines[idx])[0];
      rustLines.splice(idx, 0, ...above.map((t) => `${indent}// ${t}`));
    }
  }
  return rustLines.join("\n");
}

export function docCheck(ttmSrc, sidecarMd) {
  const items = topLevelItems(ttmSrc);
  const { sections } = parseSidecar(sidecarMd);
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  const diags = [];
  for (const name of Object.keys(sections)) {
    if (!byName[name]) {
      diags.push({ rule: "doc-orphan", severity: "error", item: name,
        message: `Doc section \`## ${name}\` has no matching item in the code.`,
        suggestion: "The item was removed or renamed — delete the section or rename its header." });
    } else if (sections[name].sig && sections[name].sig !== byName[name].sig) {
      diags.push({ rule: "doc-stale-signature", severity: "warning", item: name, line: byName[name].line,
        message: `Signature changed since the doc was written.`,
        recorded: sections[name].sig, current: byName[name].sig,
        suggestion: "Review the doc body, then run --doc-sync to update the recorded signature." });
    }
  }
  for (const it of items) {
    if (!sections[it.name]) {
      diags.push({ rule: "doc-missing", severity: "info", item: it.name, line: it.line,
        message: `${it.kind} \`${it.name}\` has no doc section.`,
        suggestion: `Run --doc-sync to append a stub, or add \`## ${it.name}\` to the sidecar.` });
    }
  }
  // inline-comment ledger: every anchor must still exist as a .ttm line
  const srcTrimmed = ttmSrc.split("\n").map((l) => l.trim());
  for (const [name, sec] of Object.entries(sections)) {
    for (const e of sec.inline ?? []) {
      if (srcTrimmed.filter((l) => l === e.anchor).length < (e.nth ?? 1)) {
        const isSafety = /^\s*SAFETY\b/i.test(e.text);
        diags.push({ rule: "comment-orphan", severity: isSafety ? "error" : "warning", item: name,
          anchor: e.anchor, comment: e.text,
          message: isSafety
            ? `SAFETY comment lost its anchor — the unsafe contract is dangling.`
            : `Ledgered comment lost its anchor (the code line changed or was removed).`,
          suggestion: `Re-anchor the entry to the current line, or delete it if obsolete.` });
      }
    }
  }
  return diags;
}

export function docSync(ttmSrc, sidecarMd) {
  const items = topLevelItems(ttmSrc);
  const { intro, sections, order } = parseSidecar(sidecarMd);
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  const out = [];
  const introTrimmed = [...intro];
  while (introTrimmed.length && introTrimmed[introTrimmed.length - 1].trim() === "") introTrimmed.pop();
  out.push(...introTrimmed);
  for (const name of order) {
    const s = sections[name];
    out.push("", `## ${name}`, "");
    // update (or add) the recorded signature for items that still exist
    if (byName[name]) out.push(`\`${byName[name].sig}\``, "");
    else if (s.sig) out.push(`\`${s.sig}\``, "");
    const body = [...s.body];
    while (body.length && body[0].trim() === "") body.shift();
    while (body.length && body[body.length - 1].trim() === "") body.pop();
    out.push(...body);
    if (s.inline?.length) {
      out.push("");
      for (const e of s.inline) out.push(`~ ${e.kind} \`${e.anchor}\`${(e.nth ?? 1) > 1 ? `#${e.nth}` : ""}: ${e.text}`);
    }
  }
  for (const it of items) {
    if (!sections[it.name]) {
      out.push("", `## ${it.name}`, "", `\`${it.sig}\``, "", `TODO: document this ${it.kind}.`);
    }
  }
  return out.join("\n") + "\n";
}

// ---------- diagnostics (--check): structured, LLM-facing, with fix suggestions ----------

export function diagnose(src) {
  const diags = [];
  const push = (line, rule, severity, message, suggestion) =>
    diags.push({ line, rule, severity, message, found: src.split("\n")[line - 1]?.trim() ?? "", suggestion });

  const lines = src.split("\n");
  lines.forEach((raw, idx) => {
    const n = idx + 1;
    // squash string-literal contents so rules never fire on text inside strings
    const bare = raw
      .replace(/r(#*)".*?"\1/g, '""')
      .replace(/"(\\.|[^"\\])*"/g, '""')
      .replace(/'(\\.|[^'\\])'/g, "''")
      .trim();
    if (bare === "") return;

    if (/^\s*use\s+[\w:]/.test(bare)) {
      push(n, "no-use-lines", "error",
        "Tatamu has no `use` lines — imports are auto-resolved by the transpiler.",
        "Delete this line and refer to the std name directly (HashMap, fs, env, ...).");
    }
    const noPatLet = bare.replace(/\b(if|while|else if)\s+let\b/g, "");
    if (/\blet\s+(mut\s+)?[A-Za-z_]\w*\s*(:[^=]*)?=/.test(noPatLet)) {
      const m = /let\s+(mut\s+)?([A-Za-z_]\w*)\s*(:\s*[^=]+?)?\s*=\s*(.*)/.exec(noPatLet);
      const fix = m ? `${m[1] ?? ""}${m[2]}${m[3] ? m[3].trim().replace(/;$/, "") : ""} := ${(m[4] ?? "").replace(/;\s*$/, "")}` : null;
      push(n, "no-let-binding", "error",
        "Bindings use `:=`, not `let` (`if let` / `while let` pattern matching is fine).",
        fix ? `Write: ${fix}` : "Use `name := expr` or `mut name := expr`.");
    }
    if (/^mut\s+[A-Za-z_]\w*\s*=[^=]/.test(bare)) {
      const m = /^mut\s+([A-Za-z_]\w*)\s*=\s*(.*)/.exec(bare);
      push(n, "mut-binding-needs-walrus", "error",
        "`mut name = expr` is neither a binding (`:=`) nor a plain reassignment (`name = expr`).",
        `If declaring: mut ${m[1]} := ${m[2].replace(/;\s*$/, "")} — if reassigning: ${m[1]} = ${m[2].replace(/;\s*$/, "")}`);
    }
    if (/\bfn\b[^{]*->/.test(bare)) {
      push(n, "no-arrow", "error",
        "Function signatures drop `->`: the return type follows the parameter list directly.",
        `Write: ${bare.replace(/\s*->\s*/, " ")}`);
    }
    if (/^#\[derive\(/.test(bare)) {
      const m = /^#\[derive\(([^)]*)\)\]/.exec(bare);
      push(n, "derive-shorthand", "error",
        "Derives are written as `+List` after the struct name, not as an attribute.",
        m ? `Merge into the struct line: struct Name +${m[1].split(",").map((d) => d.trim()).join(",")} {...}` : "Use `struct Name +Debug,Clone {...}`.");
    }
    if (/\bpub\s+(fn|struct|enum|const|trait|mod|use)\b/.test(bare)) {
      push(n, "no-pub", "error",
        "Everything is public by default — `pub` does not exist in Tatamu.",
        `Write: ${bare.replace(/\bpub\s+/, "")}`);
    }
    if (/^[ \t]/.test(raw) && raw.trim() !== "") {
      push(n, "no-indentation", "warning",
        "Lines start at column 0 — indentation wastes tokens (it is re-created on expansion).",
        "Remove the leading whitespace.");
    }
    if (/\/\/|\/\*/.test(bare)) {
      push(n, "no-comments", "warning",
        "Tatamu has no comments — documentation lives out-of-band in the sidecar .doc.md.",
        "Delete the comment; put durable documentation in the sidecar (see --doc-sync).");
    }
    if (/;\s*$/.test(bare) && !/^(use|const)\b/.test(bare)) {
      push(n, "trailing-semicolon", "info",
        "A newline already terminates the statement; the trailing `;` is tolerated but wasteful.",
        "Drop the trailing `;`.");
    }
  });

  // unbalanced delimiters across the file
  for (const [open, close, name] of [["{", "}", "braces"], ["(", ")", "parens"], ["[", "]", "brackets"]]) {
    let o = 0, c = 0;
    for (const raw of lines) {
      const bare = stripLiterals(raw);
      o += (bare.match(new RegExp("\\" + open, "g")) ?? []).length;
      c += (bare.match(new RegExp("\\" + close, "g")) ?? []).length;
    }
    if (o !== c) {
      push(lines.length, "unbalanced-delimiters", "error",
        `Unbalanced ${name}: ${o} opening vs ${c} closing.`,
        `Add the missing ${o > c ? close : open}.`);
    }
  }
  return diags;
}

// ---------- project mode (--project): .ttm directory → cargo project ----------
//
// - main.ttm → src/main.rs (gets `mod x;` for every sibling)
// - other .ttm → src/<name>.rs
// - cross-module refs: each file that mentions a top-level item of module m gets
//   `use crate::<m>::*;`
// - `#dep name version` lines anywhere become [dependencies] in Cargo.toml

function pubify(rust, privLines = new Set()) {
  let depth = 0;
  const traitImplAt = [];
  const structAt = [];
  return rust.split("\n").map((line, lineIdx) => {
    const bare = stripLiterals(line);
    const opens = (bare.match(/{/g) ?? []).length;
    const closes = (bare.match(/}/g) ?? []).length;
    const t = line.trimStart();
    let outLine = line;
    if (traitImplAt.length === 0 && !/^pub\b/.test(t) && !privLines.has(lineIdx)) {
      if (depth === 0 && /^(fn|struct|enum|trait|const|extern\s+"[^"]*"\s+fn)\b/.test(t)) outLine = line.replace(t, "pub " + t);
      else if (depth === 1 && /^fn\b/.test(t)) outLine = line.replace(/^(\s*)fn\b/, "$1pub fn");
      else if (depth === 1 && structAt.length && /^[a-z_]\w*:/.test(t)) outLine = line.replace(t, "pub " + t);
    }
    if (/^(pub\s+)?struct\b/.test(t) && opens > closes) structAt.push(depth);
    if (structAt.length && depth + opens - closes <= structAt[structAt.length - 1]) structAt.pop();
    if (/^impl\b.*\bfor\b/.test(t) && opens > closes) traitImplAt.push(depth);
    depth += opens - closes;
    if (traitImplAt.length && depth <= traitImplAt[traitImplAt.length - 1]) traitImplAt.pop();
    return outLine;
  }).join("\n");
}

export function buildProject(srcFiles, projectName) {
  const modules = {};
  const deps = {};
  let crateTypes = null; // `#crate staticlib,cdylib` directive
  for (const [name, src] of Object.entries(srcFiles)) {
    const kept = [];
    for (const line of src.split("\n")) {
      // `#dep name version [features=a,b]`
      const d = /^#dep\s+([\w-]+)\s+(\S+)(?:\s+features=([\w,-]+))?\s*$/.exec(line.trim());
      const c = /^#crate\s+([\w,-]+)\s*$/.exec(line.trim());
      if (d) deps[d[1]] = d[3] ? { version: d[2], features: d[3].split(",") } : d[2];
      else if (c) crateTypes = c[1].split(",").map((t) => t.trim());
      else kept.push(line);
    }
    const mapped = transpileMapped(kept.join("\n"));
    // kept dropped #dep/#crate lines, so remap through kept's original line numbers
    const keptNums = [];
    {
      let i = 0;
      for (const line of src.split("\n")) {
        i++;
        const t = line.trim();
        if (/^#(dep|crate)\s/.test(t)) continue;
        keptNums.push(i);
      }
    }
    modules[name] = { rust: mapped.rust, map: mapped.map.map((n) => (n === null ? null : keptNums[n - 1])), privLines: mapped.privLines };
  }
  // lib.ttm makes a library crate; if main.ttm is ALSO present, the project is
  // bin+lib: lib.rs is the module root (pub mods) and main.rs consumes the lib.
  const isLib = "lib" in modules;
  const hasBoth = isLib && "main" in modules;
  const root = isLib ? "lib" : "main";
  const crateName = projectName.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  const crateIdent = crateName.replace(/-/g, "_");

  // top-level item names per module (from transpiled Rust)
  const items = {};
  for (const [name, { rust }] of Object.entries(modules)) {
    items[name] = [...rust.matchAll(/^(?:pub\s+)?(?:fn|struct|enum|trait|const)\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]);
  }

  // module tree: keys may be nested paths ("net/http"). Each directory needs a
  // Rust module file declaring its children; missing ones are synthesized.
  const modKeys = Object.keys(modules);
  const childrenOf = {}; // dirPath ("" = root) -> Set of immediate child segments
  const addChild = (dir, seg) => ((childrenOf[dir] ??= new Set()).add(seg));
  for (const key of modKeys) {
    const segs = key.split("/");
    for (let d = 0; d < segs.length; d++) addChild(segs.slice(0, d).join("/"), segs[d]);
  }
  const out = {};
  const maps = {};
  for (const [name, { rust, map, privLines }] of Object.entries(modules)) {
    const uses = [];
    // a test module's imports are unused outside cfg(test) — silence that lint
    if (/#\[test\]/.test(rust)) uses.push("#![allow(unused_imports)]");
    const usePrefix = hasBoth && name === "main" ? crateIdent : "crate";
    for (const [other, names] of Object.entries(items)) {
      if (other === name || other === root || other === "main") continue;
      if (names.some((n) => new RegExp(`\\b${n}\\b`).test(rust))) {
        uses.push(`use ${usePrefix}::${other.replace(/\//g, "::")}::*;`);
      }
    }
    // items in library modules must be pub for cross-module access (S3: public by default);
    // methods inside `impl Trait for Type` blocks must NOT be pub. A lib.rs root is
    // pubified too — its items are the crate's public API.
    const body = name === "main" ? rust : pubify(rust, privLines);
    const header = [];
    if (name === root) {
      for (const seg of childrenOf[""] ?? []) {
        if (seg === root || (isLib && seg === "main")) continue;
        header.push(hasBoth ? `pub mod ${seg};` : `mod ${seg};`);
      }
    }
    // a module that is also a directory declares its children
    if (childrenOf[name]) {
      for (const seg of childrenOf[name]) header.push(`pub mod ${seg};`);
    }
    const prefix = [...header, ...uses, ...(header.length || uses.length ? [""] : [])];
    out[`src/${name}.rs`] = [...prefix, body].join("\n");
    maps[`src/${name}.rs`] = [...prefix.map(() => null), ...map];
  }
  // synthesize module files for directories that have no .ttm of their own
  for (const [dir, kids] of Object.entries(childrenOf)) {
    if (dir === "" || modules[dir]) continue;
    const content = [...kids].map((seg) => `pub mod ${seg};`).join("\n") + "\n";
    out[`src/${dir}.rs`] = content;
    maps[`src/${dir}.rs`] = content.split("\n").map(() => null);
  }

  const depLines = Object.entries(deps).map(([n, v]) =>
    typeof v === "string"
      ? `${n} = "${v}"`
      : `${n} = { version = "${v.version}", features = [${v.features.map((f) => `"${f}"`).join(", ")}] }`);
  if (isLib) {
    const h = generateHeader(out["src/lib.rs"], crateName);
    if (h.exports > 0) out[`include/${crateName}.h`] = h.header;
    const jb = generateJsBinding(out["src/lib.rs"], crateName);
    if (jb.exports > 0) {
      out[`js/${crateName}.mjs`] = jb.binding;
      out[`js/${crateName}.d.mts`] = generateDts(out["src/lib.rs"], crateName).dts;
    }
    const db = generateDartBinding(out["src/lib.rs"], crateName);
    if (db.exports > 0) out[`dart/${crateName.replace(/-/g, "_")}.dart`] = db.binding;
  }
  out["Cargo.toml"] = [
    "[package]",
    `name = "${crateName}"`,
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    ...(crateTypes ? ["[lib]", `crate-type = [${crateTypes.map((t) => `"${t}"`).join(", ")}]`, ""] : []),
    "[dependencies]",
    ...depLines,
    "",
    // size-optimized profile for wasm builds: cargo build --profile wasm --target wasm32-…
    // (a custom profile, so native release builds are untouched)
    ...(isLib ? [
      "[profile.wasm]",
      'inherits = "release"',
      'opt-level = "z"',
      "lto = true",
      "codegen-units = 1",
      'panic = "abort"',
      "strip = true",
      "",
    ] : []),
  ].join("\n");
  return { files: out, maps };
}

// CLI
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const projIdx = args.indexOf("--project");
  if (projIdx !== -1) {
    const [srcDir, outDir] = args.slice(projIdx + 1).filter((a) => !a.startsWith("--"));
    if (!srcDir || !outDir) { console.error("usage: tatamuc --project <srcdir> <outdir>"); process.exit(1); }
    const { readdirSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { join, basename } = await import("node:path");
    const walkTtm = (dir, base = "") => {
      const found = {};
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) Object.assign(found, walkTtm(join(dir, e.name), base ? `${base}/${e.name}` : e.name));
        else if (e.name.endsWith(".ttm")) found[(base ? base + "/" : "") + e.name.replace(/\.ttm$/, "")] = readFileSync(join(dir, e.name), "utf8");
      }
      return found;
    };
    const srcFiles = walkTtm(srcDir);
    const { files } = buildProject(srcFiles, basename(outDir));
    for (const [rel, content] of Object.entries(files)) {
      const dest = join(outDir, rel);
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, content);
      console.error(`wrote ${dest}`);
    }
    process.exit(0);
  }
  const docsIdx = args.indexOf("--docs");
  const docsFile = docsIdx !== -1 ? args[docsIdx + 1] : null;
  const header = args.includes("--header");
  const compile = args.includes("--compile");
  const file = args.filter((a, i) => !a.startsWith("--") && (docsIdx === -1 || i !== docsIdx + 1))[0];
  if (!file) { console.error("usage: tatamuc [--check] [--header] [--docs <file.doc.md>] <file.ttm> | --project <srcdir> <outdir>"); process.exit(1); }
  const isDir = statSync(file).isDirectory();
  const src = isDir ? null : readFileSync(file, "utf8");
  if (header) {
    const name = file.split("/").pop().replace(/\.ttm$/, "");
    const h = generateHeader(transpile(src.split("\n").filter((l) => !/^#(dep|crate)\s/.test(l.trim())).join("\n")), name);
    for (const w of h.warnings) console.error(`warning: ${w}`);
    process.stdout.write(h.header);
    process.exit(0);
  }
  if (args.includes("--jsbind")) {
    const name = file.split("/").pop().replace(/\.ttm$/, "");
    const jb = generateJsBinding(transpile(src.split("\n").filter((l) => !/^#(dep|crate)\s/.test(l.trim())).join("\n")), name);
    for (const w of jb.warnings) console.error(`warning: ${w}`);
    process.stdout.write(jb.binding);
    process.exit(0);
  }
  if (args.includes("--doc-check") || args.includes("--doc-sync")) {
    const sidecarPath = docsFile ?? file.replace(/\.ttm$/, ".doc.md");
    let sidecar = "";
    try { sidecar = readFileSync(sidecarPath, "utf8"); } catch { /* missing sidecar = everything undocumented */ }
    if (args.includes("--doc-sync")) {
      const { writeFileSync } = await import("node:fs");
      const updated = docSync(src, sidecar);
      writeFileSync(sidecarPath, updated);
      console.error(`updated ${sidecarPath}`);
      process.exit(0);
    }
    const diags = docCheck(src, sidecar);
    console.log(JSON.stringify({ file, sidecar: sidecarPath, ok: !diags.some((d) => d.severity === "error"), diagnostics: diags }, null, 2));
    process.exit(diags.some((d) => d.severity === "error") ? 1 : 0);
  }
  if (args.includes("--dartbind")) {
    const name = file.split("/").pop().replace(/\.ttm$/, "");
    const db = generateDartBinding(transpile(src.split("\n").filter((l) => !/^#(dep|crate)\s/.test(l.trim())).join("\n")), name);
    for (const w of db.warnings) console.error(`warning: ${w}`);
    process.stdout.write(db.binding);
    process.exit(0);
  }
  if (args.includes("--dts")) {
    const name = file.split("/").pop().replace(/\.ttm$/, "");
    const d = generateDts(transpile(src.split("\n").filter((l) => !/^#(dep|crate)\s/.test(l.trim())).join("\n")), name);
    for (const w of d.warnings) console.error(`warning: ${w}`);
    process.stdout.write(d.dts);
    process.exit(0);
  }
  if (check) {
    const diags = diagnose(src);
    console.log(JSON.stringify({ file, ok: !diags.some((d) => d.severity === "error"), diagnostics: diags }, null, 2));
    process.exit(diags.some((d) => d.severity === "error") ? 1 : 0);
  }
  if (compile && isDir) {
    // project compile: buildProject → cargo check (JSON) → remap spans to each .ttm
    const { spawnSync } = await import("node:child_process");
    const { tmpdir } = await import("node:os");
    const { join, basename } = await import("node:path");
    const { readdirSync, writeFileSync, mkdtempSync, mkdirSync } = await import("node:fs");
    const walkTtm = (dir, base = "") => {
      const found = {};
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) Object.assign(found, walkTtm(join(dir, e.name), base ? `${base}/${e.name}` : e.name));
        else if (e.name.endsWith(".ttm")) found[(base ? base + "/" : "") + e.name.replace(/\.ttm$/, "")] = readFileSync(join(dir, e.name), "utf8");
      }
      return found;
    };
    const srcFiles = walkTtm(file);
    const { files, maps } = buildProject(srcFiles, basename(file));
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "tatamuc-proj-"));
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    const r = spawnSync("cargo", ["check", "--message-format=json", "--manifest-path", join(dir, "Cargo.toml")],
      { encoding: "utf8", timeout: 120000 });
    const diags = [];
    for (const raw of (r.stdout ?? "").split("\n")) {
      if (!raw.trim().startsWith("{")) continue;
      let m0;
      try { m0 = JSON.parse(raw); } catch { continue; }
      if (m0.reason !== "compiler-message") continue;
      const d = m0.message;
      if (d.level !== "error" && d.level !== "warning") continue;
      const span = (d.spans ?? []).find((s) => s.is_primary) ?? (d.spans ?? [])[0];
      let ttmFile = null, ttmLine = null, found = null;
      if (span) {
        const rel = span.file_name.replace(/^.*src\//, "src/");
        const mod = /^src\/([\w/]+)\.rs$/.exec(rel)?.[1];
        if (mod && maps[rel]) {
          ttmFile = `${mod}.ttm`;
          ttmLine = maps[rel][span.line_start - 1] ?? null;
          if (ttmLine && srcFiles[mod]) found = (srcFiles[mod].split("\n")[ttmLine - 1] ?? "").trim();
        }
      }
      const help = (d.children ?? []).filter((c) => c.level === "help").map((c) => c.message).join("; ");
      diags.push({ level: d.level, code: d.code?.code ?? null, file: ttmFile, line: ttmLine, found, message: d.message, ...(help ? { help } : {}) });
    }
    console.log(JSON.stringify({ project: file, ok: r.status === 0, diagnostics: diags }, null, 2));
    process.exit(r.status === 0 ? 0 : 1);
  }
  if (compile) {
    // transpile → rustc (type-check only) → remap rustc spans back to .ttm lines
    const { spawnSync } = await import("node:child_process");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { rust, map } = transpileMapped(src);
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "tatamuc-"));
    const rsFile = join(dir, "t.rs");
    writeFileSync(rsFile, rust);
    const r = spawnSync("rustc", ["--edition", "2021", "--emit=metadata", "--error-format=json",
      "--crate-name", "t", "--out-dir", dir, rsFile], { encoding: "utf8", timeout: 60000 });
    const srcLines = src.split("\n");
    const diags = [];
    for (const raw of (r.stderr ?? "").split("\n")) {
      if (!raw.trim().startsWith("{")) continue;
      let d;
      try { d = JSON.parse(raw); } catch { continue; }
      if (d.level !== "error" && d.level !== "warning") continue;
      const span = (d.spans ?? []).find((s) => s.is_primary) ?? (d.spans ?? [])[0];
      const ttmLine = span ? (map[span.line_start - 1] ?? null) : null;
      const help = (d.children ?? []).filter((c) => c.level === "help").map((c) => c.message).join("; ");
      diags.push({
        level: d.level,
        code: d.code?.code ?? null,
        line: ttmLine,
        found: ttmLine ? (srcLines[ttmLine - 1] ?? "").trim() : null,
        message: d.message,
        ...(help ? { help } : {}),
      });
    }
    console.log(JSON.stringify({ file, ok: r.status === 0, diagnostics: diags }, null, 2));
    process.exit(r.status === 0 ? 0 : 1);
  }
  if (docsFile) {
    const sidecar = readFileSync(docsFile, "utf8");
    const { rust: mappedRust, map } = transpileMapped(src);
    process.stdout.write(mergeDocs(attachInlineComments(mappedRust, map, src, sidecar), sidecar));
  } else {
    process.stdout.write(transpile(src));
  }
}
