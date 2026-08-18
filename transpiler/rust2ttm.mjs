// rust2ttm — Rust → Tatamu reverse-transpiler PROTOTYPE (feasibility study).
//
// Handles idiomatic rustfmt-style Rust:
//   - doc comments (//! and ///) → sidecar .doc.md sections (item-anchored)
//   - inline // and /* */ comments → dropped (counted)
//   - multi-line statements (rustfmt wrapping) → joined to one line
//   - let / signatures / derive / fields / pub / const → Tatamu forms
//   - use lines: crate/super/std-prelude → dropped, others → #use
//   - #[cfg(test)] mod tests { use super::*; … } → flattened top-level #[test] fns
//
// usage: node transpiler/rust2ttm.mjs <src-dir-with-rs> <out-dir>

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// std names the Tatamu prelude re-injects — their `use` lines can be dropped
const PRELUDE_COVERED = /^(std::collections::(HashMap|HashSet)|std::(env|fs|process|thread|mem|fmt)|std::error::Error|std::f64::consts::PI|std::sync::(mpsc|Arc|Mutex)|std::cmp::Ordering|std::str::FromStr|std::fmt::(Display|Formatter)|std::io::(BufRead|BufReader))(;|$)/;

const stats = { comments: 0, docLines: 0, usesDropped: 0, usesKept: 0 };

function convertFile(src, modName, siblingMods = []) {
  const rawLines = src.split("\n");
  const out = [];
  const sidecar = { intro: [], items: [] }; // items: [name, [docLines]]
  let pendingDoc = [];
  let inTestMod = 0; // brace depth inside #[cfg(test)] mod
  let expectTestMod = false;

  // pass 1: strip comments, collect docs, drop blank lines
  const lines = [];
  let inBlockComment = false;
  for (let raw of rawLines) {
    if (inBlockComment) {
      const end = raw.indexOf("*/");
      if (end === -1) { stats.comments++; continue; }
      raw = raw.slice(end + 2);
      inBlockComment = false;
    }
    let line = raw;
    // strip /* … */ (line-local or opening)
    for (;;) {
      const s = line.indexOf("/*");
      if (s === -1 || inString(line, s)) break;
      const e = line.indexOf("*/", s + 2);
      stats.comments++;
      if (e === -1) { line = line.slice(0, s); inBlockComment = true; break; }
      line = line.slice(0, s) + line.slice(e + 2);
    }
    const t = line.trim();
    if (t.startsWith("//!")) { sidecar.intro.push(t.slice(3).trim()); stats.docLines++; continue; }
    if (t.startsWith("///")) { pendingDoc.push(t.slice(3).trim()); stats.docLines++; continue; }
    // inline or full-line // comment (outside strings)
    const sl = findLineComment(line);
    if (sl !== -1) { stats.comments++; line = line.slice(0, sl); }
    if (line.trim() === "") continue;
    lines.push({ line: line.replace(/\s+$/, ""), doc: pendingDoc.length ? pendingDoc : null });
    if (pendingDoc.length) pendingDoc = [];
  }

  // pass 2: join rustfmt-wrapped statements into single lines
  const joined = [];
  let buf = null;
  const flush = () => { if (buf) { joined.push(buf); buf = null; } };
  for (let i = 0; i < lines.length; i++) {
    const { line, doc } = lines[i];
    const t = line.trim();
    if (!buf) buf = { text: t, doc };
    else buf.text += (buf.text.endsWith("(") || t.startsWith(")") || t.startsWith(".") || t.startsWith("]") ? "" : " ") + t;
    const bare = squash(buf.text);
    const depth = count(bare, /[([]/g) - count(bare, /[)\]]/g);
    const next = lines[i + 1]?.line.trim() ?? "";
    const terminated = /[;{}]$/.test(bare) || /,$/.test(bare) || /^#\[/.test(bare) || /^\}/.test(next) || next === "";
    if (depth <= 0 && terminated) flush();
  }
  flush();

  // pass 3: structural conversion
  let depthStack = 0;
  for (let i = 0; i < joined.length; i++) {
    let { text: t, doc } = joined[i];
    const bare = squash(t);

    // test-mod flattening
    if (/^#\[cfg\(test\)\]$/.test(bare)) { expectTestMod = true; continue; }
    if (expectTestMod && /^(pub\s+)?mod\s+\w+\s*\{$/.test(bare)) { inTestMod = 1; expectTestMod = false; continue; }
    if (inTestMod) {
      const d = count(bare, /{/g) - count(bare, /}/g);
      if (bare === "}" && inTestMod === 1) { inTestMod = 0; continue; }
      inTestMod += d === 0 && bare === "}" ? -1 : d;
      if (/^use\s+super::\*;$/.test(bare)) continue;
    }
    expectTestMod = false;

    // use lines
    const um = /^(?:pub\s+)?use\s+(.+);$/.exec(bare);
    if (um) {
      const path = um[1].trim();
      if (/^(crate|super|self)\b/.test(path) || PRELUDE_COVERED.test(path)) { stats.usesDropped++; continue; }
      stats.usesKept++;
      out.push({ text: `#use ${path}`, doc: null });
      continue;
    }
    if (/^mod\s+\w+;$/.test(bare)) continue; // module decls are auto-generated

    // derive attr: merge into the following struct/enum line
    const dm = /^#\[derive\(([^)]*)\)\]$/.exec(bare);
    if (dm && joined[i + 1]) {
      const nxt = joined[i + 1];
      nxt.text = nxt.text.replace(/^(\s*)(?:pub\s+)?(struct|enum)\s+(\w+(?:<[^{]*>)?)/,
        (m0, sp, kw, name) => `${kw} ${name} +${dm[1].split(",").map((d) => d.trim()).join(",")}`);
      nxt.doc = doc ?? nxt.doc;
      continue;
    }

    t = t.trim().replace(/^pub(\([^)]*\))?\s+/, "");

    // let bindings (not if/while let)
    t = t.replace(/^let\s+mut\s+(\w+)(:\s*[^=]+?)?\s*=\s*/, (m0, name, ty) => `mut ${name}${ty ? ty.replace(/\s+$/, "") : ""} := `);
    t = t.replace(/^let\s+(\([^)]*\)|\w+)(:\s*[^=]+?)?\s*=\s*(?!=)/, (m0, name, ty) => `${name}${ty ? ty.replace(/\s+$/, "") : ""} := `);

    // fn signatures: strip param colons + arrow (generics untouched)
    t = t.replace(/\bfn\s+(\w+)(<[^>]*>)?\s*\(([^)]*)\)\s*(->\s*)?/, (m0, name, gen, params, arrow) => {
      const p = params.split(/,(?![^<(]*[>)])/).map((x) => x.trim().replace(/^(mut\s+)?(\w+):\s*/, "$1$2 ")).join(", ");
      return `fn ${name}${gen ?? ""}(${p}) `;
    });

    // struct/enum field colons (only inside struct/enum bodies — approximate by pattern `name: Type,`)
    if (/^\w+:\s+[^=]+,$/.test(squash(t)) && depthStack > 0 && joined.at(i)) {
      t = t.replace(/^(\w+):\s+/, "$1 ");
    }

    // const
    t = t.replace(/^const\s+(\w+):\s*/, "const $1 ");

    // same-crate module qualifiers resolve via Tatamu's glob injection — strip them
    if (siblingMods.length) {
      const re = new RegExp(`\\b(?:${siblingMods.join("|")})::`, "g");
      t = t.split(/("(?:\\.|[^"\\])*")/).map((seg, k) => (k % 2 ? seg : seg.replace(re, ""))).join("");
    }

    // drop trailing semicolons (Tatamu newline-terminates); keep intra-line ones
    t = t.replace(/;$/, "");

    if (doc) sidecar.items.push([itemName(t), doc]);
    out.push({ text: t, doc: null });
    depthStack += count(squash(t), /{/g) - count(squash(t), /}/g);
  }

  const ttm = out.map((l) => l.text).join("\n") + "\n";
  let doc = "";
  if (sidecar.intro.length || sidecar.items.length) {
    const parts = [`# ${modName}`, "", ...sidecar.intro];
    for (const [name, docLines] of sidecar.items) {
      if (!name) continue;
      parts.push("", `## ${name}`, "", ...docLines);
    }
    doc = parts.join("\n") + "\n";
  }
  return { ttm, doc };
}

const squash = (s) => s.replace(/r(#*)".*?"\1/g, '""').replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])'/g, "''");
// length-preserving squash: string contents become 'S' so indexes stay aligned
const blank = (s) => s.replace(/r(#*)".*?"\1|"(\\.|[^"\\])*"|'(\\.|[^'\\])'/g, (m) => "S".repeat(m.length));
const count = (s, re) => (s.match(re) ?? []).length;
const inString = (line, idx) => blank(line)[idx] === "S";
function findLineComment(line) {
  return blank(line).indexOf("//");
}
function itemName(t) {
  return /^(?:async\s+)?(?:fn|struct|enum|trait|const)\s+(\w+)/.exec(t)?.[1] ?? null;
}

// CLI
const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) { console.error("usage: rust2ttm <src-dir> <out-dir>"); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const allMods = readdirSync(srcDir).filter((f) => f.endsWith(".rs")).map((f) => f.replace(/\.rs$/, ""));
for (const f of readdirSync(srcDir).filter((f) => f.endsWith(".rs"))) {
  const name = f.replace(/\.rs$/, "");
  const { ttm, doc } = convertFile(readFileSync(join(srcDir, f), "utf8"), name, allMods.filter((m) => m !== name && m !== "main"));
  writeFileSync(join(outDir, `${name}.ttm`), ttm);
  if (doc) writeFileSync(join(outDir, `${name}.doc.md`), doc);
  console.error(`wrote ${name}.ttm${doc ? " + .doc.md" : ""}`);
}
console.error(`stats: ${JSON.stringify(stats)}`);
