// v0.2 round: token totals vs round-1 Rust controls + rule-violation scan.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../token-analysis/package.json"));
const o200k = require("gpt-tokenizer/encoding/o200k_base");
const r1 = JSON.parse(readFileSync(join(HERE, "results.json"), "utf8"));

const extract = (md) => {
  const p = {};
  const re = /###\s+(\w+)\s*\n+```[a-z]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) p[m[1]] = m[2];
  return p;
};

console.log("model  | v2 tatamu tok | rust tok (r1) | savings | violations");
for (const f of readdirSync(join(HERE, "outputs-v2"))) {
  const model = f.replace("-tatamu.md", "");
  const progs = extract(readFileSync(join(HERE, "outputs-v2", f), "utf8"));
  let tok = 0, viol = 0;
  for (const src of Object.values(progs)) {
    tok += o200k.encode(src.trim()).length;
    for (const line of src.split("\n")) {
      const s = line.replace(/"(\\.|[^"\\])*"/g, '""');
      if (/^\s*use\s+\w/.test(s)) viol++;
      if (/\blet\b/.test(s.replace(/\b(if|while|else if)\s+let\b/g, ""))) viol++;
      if (/->/.test(s)) viol++;
      if (/#\[derive/.test(s)) viol++;
      if (/;\s*$/.test(s)) viol++;
      if (/^[ \t]+\S/.test(line)) viol++;
    }
  }
  const rust = r1[model].rust.totalTokens;
  console.log(
    model.padEnd(7) + "| " + String(tok).padEnd(14) + "| " + String(rust).padEnd(14) + "| " +
    ((1 - tok / rust) * 100).toFixed(1) + "%   | " + viol
  );
}
