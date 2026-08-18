// Transpiler sanity tests over the whole corpus:
//   - 5 hand-written paper-prototype programs (.ttm)
//   - 24 LLM-generated Tatamu programs (experiments/llm-generation/outputs/*-tatamu.md)
//
// Checks that transpiled output contains no leftover Tatamu syntax and is
// structurally plausible Rust. (Real compile check pending a Rust toolchain.)

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transpile } from "./tatamuc.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const corpus = [];
const ttmDir = join(ROOT, "experiments/paper-prototype/tatamu");
for (const f of readdirSync(ttmDir).filter((f) => f.endsWith(".ttm"))) {
  corpus.push({ id: `hand/${f}`, src: readFileSync(join(ttmDir, f), "utf8") });
}
const genDir = join(ROOT, "experiments/llm-generation/outputs");
for (const f of readdirSync(genDir).filter((f) => f.endsWith("-tatamu.md"))) {
  const md = readFileSync(join(genDir, f), "utf8");
  const re = /###\s+(\w+)\s*\n+```[a-z]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    corpus.push({ id: `${f.replace("-tatamu.md", "")}/${m[1]}`, src: m[2] });
  }
}

const stripStrings = (line) =>
  line.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])'/g, "''");

function checkRust(out) {
  const problems = [];
  const bare = out.split("\n").map(stripStrings).join("\n");
  if (/:=/.test(bare)) problems.push("leftover :=");
  if (/\bR</.test(bare)) problems.push("leftover R<>");
  if (/^\s*struct\s+\w+\s*\+/m.test(bare)) problems.push("leftover +derive");
  for (const [open, close, name] of [["{", "}", "braces"], ["(", ")", "parens"], ["[", "]", "brackets"]]) {
    const o = (bare.match(new RegExp("\\" + open, "g")) ?? []).length;
    const c = (bare.match(new RegExp("\\" + close, "g")) ?? []).length;
    if (o !== c) problems.push(`unbalanced ${name} (${o} vs ${c})`);
  }
  // fn params missing colon, e.g. `fn f(a i64)` — ident space ident inside params
  for (const line of bare.split("\n")) {
    const m = /fn\s+\w+\(([^)]*)\)/.exec(line);
    if (m) {
      for (const p of m[1].split(/,(?![^<]*>)/)) {
        const t = p.trim();
        if (t && !/self\b/.test(t) && !/:/.test(t)) { problems.push(`param without colon: "${t}"`); break; }
      }
    }
  }
  // a let-statement line must end with ; or { or similar
  for (const line of bare.split("\n")) {
    const t = line.trim();
    if (/^let\b/.test(t) && !/[;{([,]$/.test(t)) problems.push(`let without terminator: "${t.slice(0, 40)}"`);
  }
  return problems;
}

let pass = 0, fail = 0;
for (const { id, src } of corpus) {
  try {
    const out = transpile(src);
    const problems = checkRust(out);
    if (problems.length) { fail++; console.log(`FAIL ${id}: ${problems.join("; ")}`); }
    else pass++;
  } catch (e) {
    fail++;
    console.log(`ERROR ${id}: ${e.message}`);
  }
}
console.log(`\n${pass}/${pass + fail} programs transpiled cleanly`);
