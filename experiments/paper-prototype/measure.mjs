// Paper-prototype measurement: plain Rust vs minified Rust (control) vs Tatamu dialect.
//
// minified = comments stripped + indentation stripped + blank lines removed.
// Tatamu savings vs minified isolate the *syntax-layer* gain from the formatting gain.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../token-analysis/package.json"));
const o200k = require("gpt-tokenizer/encoding/o200k_base");
const { getTokenizer } = require("@anthropic-ai/tokenizer");
const claudeTk = getTokenizer();

const count = {
  o200k: (t) => o200k.encode(t).length,
  claude: (t) => claudeTk.encode(t, "all").length,
};

function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c2 = src.slice(i, i + 2);
    if (c2 === "//") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = src.length;
      out = out.replace(/[ \t]+$/, "");
      i = j;
    } else if (c2 === "/*") {
      let depth = 1, j = i + 2;
      while (j < src.length && depth > 0) {
        if (src.slice(j, j + 2) === "/*") { depth++; j += 2; }
        else if (src.slice(j, j + 2) === "*/") { depth--; j += 2; }
        else j++;
      }
      i = j;
    } else if (src[i] === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, Math.min(j + 1, src.length));
      i = Math.min(j + 1, src.length);
    } else {
      out += src[i++];
    }
  }
  return out;
}

const minify = (s) =>
  stripComments(s)
    .split("\n")
    .map((l) => l.replace(/^[ \t]+/, ""))
    .filter((l) => l.trim() !== "")
    .join("\n");

const rustDir = join(HERE, "rust");
const tatamuDir = join(HERE, "tatamu");
const programs = readdirSync(rustDir).filter((f) => f.endsWith(".rs")).map((f) => f.replace(/\.rs$/, ""));

const rows = [];
for (const name of programs) {
  const rust = readFileSync(join(rustDir, name + ".rs"), "utf8");
  const ori = readFileSync(join(tatamuDir, name + ".ttm"), "utf8");
  const rustMin = minify(rust);
  const row = { name };
  for (const [tk, c] of Object.entries(count)) {
    const r = c(rust), m = c(rustMin), o = c(ori);
    row[tk] = {
      rust: r, rust_min: m, ori: o,
      ori_vs_rust_pct: +((1 - o / r) * 100).toFixed(1),
      ori_vs_min_pct: +((1 - o / m) * 100).toFixed(1),
    };
  }
  rows.push(row);
}

// totals
const total = { name: "TOTAL" };
for (const tk of Object.keys(count)) {
  const sum = (k) => rows.reduce((s, r) => s + r[tk][k], 0);
  const r = sum("rust"), m = sum("rust_min"), o = sum("ori");
  total[tk] = {
    rust: r, rust_min: m, ori: o,
    ori_vs_rust_pct: +((1 - o / r) * 100).toFixed(1),
    ori_vs_min_pct: +((1 - o / m) * 100).toFixed(1),
  };
}
rows.push(total);

writeFileSync(join(HERE, "results.json"), JSON.stringify(rows, null, 2));

for (const tk of Object.keys(count)) {
  console.log(`\n== ${tk} ==`);
  console.log("program        rust  min   ori   ori/rust  ori/min");
  for (const r of rows) {
    const d = r[tk];
    console.log(
      r.name.padEnd(14),
      String(d.rust).padEnd(5), String(d.rust_min).padEnd(5), String(d.ori).padEnd(5),
      (d.ori_vs_rust_pct + "%").padEnd(9), d.ori_vs_min_pct + "%"
    );
  }
}
