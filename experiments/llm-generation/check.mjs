// Compliance checker + token counter for LLM generation outputs.
//
// outputs/<model>-<cond>.md contains "### task" headers each followed by a fenced code block.
// For cond=tatamu, run heuristic rule checks; for both conds, count tokens per program.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../token-analysis/package.json"));
const o200k = require("gpt-tokenizer/encoding/o200k_base");

function extractPrograms(md) {
  const programs = {};
  const re = /###\s+(\w+)\s*\n+```[a-z]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) programs[m[1]] = m[2];
  return programs;
}

// Heuristic Tatamu v0 rule checks. Each returns list of violation notes.
const RULES = {
  "S6:no-use-lines": (src) =>
    src.split("\n").filter((l) => /^\s*use\s+\w/.test(l)).map((l) => l.trim()),
  // `if let` / `while let` are pattern-match syntax, not bindings — allowed (v0.1 clarification)
  "S1:no-let": (src) =>
    src.split("\n")
      .filter((l) => /\blet\b/.test(stripStrings(l).replace(/\b(if|while|else if)\s+let\b/g, "")))
      .map((l) => l.trim()),
  "S2:no-arrow": (src) =>
    src.split("\n").filter((l) => /->/.test(stripStrings(l))).map((l) => l.trim()),
  "S2:no-param-colon": (src) =>
    src.split("\n").filter((l) => /\bfn\s+\w+\([^)]*\w+\s*:\s*[&\w]/.test(stripStrings(l))).map((l) => l.trim()),
  "S3:no-pub": (src) =>
    src.split("\n").filter((l) => /\bpub\b/.test(stripStrings(l))).map((l) => l.trim()),
  "S4:no-derive-attr": (src) =>
    src.split("\n").filter((l) => /#\[derive/.test(l)).map((l) => l.trim()),
  "S7:no-turbofish": (src) =>
    src.split("\n").filter((l) => /::</.test(stripStrings(l))).map((l) => l.trim()),
  "F1:no-indent": (src) =>
    src.split("\n").filter((l) => /^[ \t]+\S/.test(l)).map((l) => JSON.stringify(l.slice(0, 20))),
  "F1:no-comments": (src) =>
    src.split("\n").filter((l) => /\/\//.test(stripStrings(l))).map((l) => l.trim()),
  "F1:no-blank-lines": (src) => {
    const lines = src.split("\n");
    const blanks = lines.slice(0, -1).filter((l) => l.trim() === "").length;
    return blanks > 0 ? [`${blanks} blank line(s)`] : [];
  },
  "F2:no-trailing-semicolon": (src) =>
    src.split("\n").filter((l) => /;\s*$/.test(stripStrings(l))).map((l) => l.trim()),
  "uses-walrus": (src) => (/(^|\W)mut \w+ :=|\w+ :=/.test(src) ? [] : ["no := binding found"]),
};

// crude removal of string literal contents so rules don't fire inside strings
function stripStrings(line) {
  return line.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])'/g, "''");
}

const TASKS = ["anagram", "csvavg", "inventory", "dedup", "fib", "rpn"];
const files = readdirSync(join(HERE, "outputs")).filter((f) => f.endsWith(".md"));
const report = {};

for (const file of files) {
  const [model, cond] = file.replace(/\.md$/, "").split("-");
  const programs = extractPrograms(readFileSync(join(HERE, "outputs", file), "utf8"));
  const entry = { tasks: {}, totalTokens: 0, missing: TASKS.filter((t) => !(t in programs)) };

  for (const [task, src] of Object.entries(programs)) {
    const tokens = o200k.encode(src.trim()).length;
    entry.totalTokens += tokens;
    const t = { tokens };
    if (cond === "tatamu") {
      const violations = {};
      for (const [rule, fn] of Object.entries(RULES)) {
        const v = fn(src);
        if (v.length) violations[rule] = v;
      }
      t.violations = violations;
      t.violationCount = Object.values(violations).reduce((s, v) => s + v.length, 0);
    }
    entry.tasks[task] = t;
  }
  (report[model] ??= {})[cond] = entry;
}

// summary table
console.log("model    | tatamu tok | rust tok | savings | violations (by task)");
for (const [model, conds] of Object.entries(report)) {
  const t = conds.tatamu, r = conds.rust;
  if (!t || !r) { console.log(`${model}: incomplete (${Object.keys(conds)})`); continue; }
  const sav = ((1 - t.totalTokens / r.totalTokens) * 100).toFixed(1);
  const viols = TASKS.map((k) => `${k}:${t.tasks[k]?.violationCount ?? "?"}`).join(" ");
  console.log(`${model.padEnd(8)} | ${String(t.totalTokens).padEnd(10)} | ${String(r.totalTokens).padEnd(8)} | ${sav}%   | ${viols}`);
}

writeFileSync(join(HERE, "results.json"), JSON.stringify(report, null, 2));
console.log("\ndetails written to results.json");
