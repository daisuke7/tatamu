// Variant experiment: how many tokens do specific mechanical transformations save?
//
// Variants (applied outside string literals where relevant):
//   original        - as-is
//   no_indent       - strip leading whitespace on every line
//   tab_indent      - convert leading 4-space units to single tabs
//   no_comments     - remove comment lines & trailing comments (keeps code)
//   no_blank        - remove blank lines
//   minified        - no_indent + no_comments + no_blank
//   joined          - minified + join lines with single space (single logical stream)

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as o200k from "gpt-tokenizer/encoding/o200k_base";
import { getTokenizer } from "@anthropic-ai/tokenizer";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(HERE, "samples");
const claudeTk = getTokenizer();

const count = {
  o200k: (t) => o200k.encode(t).length,
  claude_legacy: (t) => claudeTk.encode(t, "all").length,
};

// crude comment stripper: relies on line/block comment detection identical to analyze.mjs lexer
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c2 = src.slice(i, i + 2);
    if (c2 === "//") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = src.length;
      // also eat whitespace before the comment on the same line
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
    } else if (src[i] === "r" && /^r#*"/.test(src.slice(i))) {
      const m = /^r(#*)"/.exec(src.slice(i));
      const close = '"' + m[1];
      let j = src.indexOf(close, i + m[0].length);
      j = j === -1 ? src.length : j + close.length;
      out += src.slice(i, j);
      i = j;
    } else {
      out += src[i++];
    }
  }
  return out;
}

const noIndent = (s) => s.split("\n").map((l) => l.replace(/^[ \t]+/, "")).join("\n");
const tabIndent = (s) => s.split("\n").map((l) => {
  const m = /^[ ]+/.exec(l);
  if (!m) return l;
  const tabs = "\t".repeat(Math.floor(m[0].length / 4)) + " ".repeat(m[0].length % 4);
  return tabs + l.slice(m[0].length);
}).join("\n");
const noBlank = (s) => s.split("\n").filter((l) => l.trim() !== "").join("\n");

const VARIANTS = {
  original: (s) => s,
  no_indent: noIndent,
  tab_indent: tabIndent,
  no_comments: (s) => noBlank(stripComments(s)),
  minified: (s) => noBlank(noIndent(stripComments(s))),
  joined: (s) => noBlank(noIndent(stripComments(s))).split("\n").join(" "),
};

const files = readdirSync(SAMPLES).filter((f) => f.endsWith(".rs"));
const totals = {};
for (const tk of Object.keys(count)) {
  totals[tk] = Object.fromEntries(Object.keys(VARIANTS).map((v) => [v, 0]));
}

for (const f of files) {
  const src = readFileSync(join(SAMPLES, f), "utf8");
  for (const [vName, fn] of Object.entries(VARIANTS)) {
    const text = fn(src);
    for (const [tk, c] of Object.entries(count)) totals[tk][vName] += c(text);
  }
}

const report = {};
for (const [tk, byVariant] of Object.entries(totals)) {
  const base = byVariant.original;
  report[tk] = Object.fromEntries(Object.entries(byVariant).map(([v, n]) => [
    v, { tokens: n, savingsPct: +((1 - n / base) * 100).toFixed(1) },
  ]));
}

writeFileSync(join(HERE, "variants.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
