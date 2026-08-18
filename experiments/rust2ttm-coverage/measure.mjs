// Coverage & throughput measurement for the syn-based rust2ttm on real crates.
//
// Per .rs file: rust2ttm convert → tatamuc expand → rust2ttm compare (AST equivalence).
// usage: node experiments/rust2ttm-coverage/measure.mjs <crate-dir> [...more]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, cpSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { transpile } from "../../transpiler/tatamuc.mjs";

const R2T = "/tmp/claude-501/rust2ttm-syn/target/release/rust2ttm-syn";
const WORK = "/tmp/claude-501/coverage-work";
const HERE = dirname(fileURLToPath(import.meta.url));

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (["target", ".git", "tests", "benches", "examples", "fuzz", "test_data", "testdata", "test-data", "fixtures"].includes(e.name)) continue;
      out.push(...walk(p));
    } else if (e.name.endsWith(".rs") && e.name !== "build.rs") out.push(p);
  }
  return out;
}

const results = [];
let convertMs = 0;

for (const crateDir of process.argv.slice(2)) {
  const crate = basename(crateDir);
  const files = walk(crateDir);
  for (const file of files) {
    const rec = { crate, file: file.replace(crateDir + "/", ""), lines: 0, stage: "", detail: "" };
    const src = readFileSync(file, "utf8");
    rec.lines = src.split("\n").length;
    const tmp = join(WORK, "one");
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(join(tmp, "in"), { recursive: true });
    writeFileSync(join(tmp, "in/mod_under_test.rs"), src);
    // 1) convert
    try {
      const t0 = performance.now();
      execFileSync(R2T, ["convert", join(tmp, "in"), join(tmp, "ttm")], { stdio: "pipe", timeout: 30000 });
      convertMs += performance.now() - t0;
    } catch (e) {
      rec.stage = "convert-fail";
      rec.detail = String(e.stderr ?? e.message).split("\n").find((l) => l.trim()) ?? "";
      results.push(rec);
      continue;
    }
    // 2) expand back to Rust with tatamuc
    let regen;
    try {
      regen = transpile(readFileSync(join(tmp, "ttm/mod_under_test.ttm"), "utf8"));
      writeFileSync(join(tmp, "regen.rs"), regen);
    } catch (e) {
      rec.stage = "expand-fail";
      rec.detail = e.message.slice(0, 120);
      results.push(rec);
      continue;
    }
    // 3) AST equivalence
    try {
      execFileSync(R2T, ["compare", file, join(tmp, "regen.rs")], { stdio: "pipe", timeout: 30000 });
      rec.stage = "equivalent";
    } catch (e) {
      const out = String(e.stdout ?? "");
      if (/item count differs/.test(String(e.stderr ?? "") + out)) rec.stage = "count-mismatch";
      else if (/MISMATCH/.test(out)) {
        rec.stage = "ast-mismatch";
        rec.detail = (out.split("\n").find((l) => l.startsWith("MISMATCH")) ?? "").slice(0, 100);
      } else {
        rec.stage = "regen-parse-fail";
        rec.detail = String(e.stderr ?? "").split("\n")[0]?.slice(0, 120) ?? "";
      }
    }
    results.push(rec);
  }
}

// ---- report ----
const byCrate = {};
for (const r of results) {
  const c = (byCrate[r.crate] ??= { total: 0, lines: 0, stages: {} });
  c.total++;
  c.lines += r.lines;
  c.stages[r.stage] = (c.stages[r.stage] ?? 0) + 1;
}
const STAGES = ["equivalent", "ast-mismatch", "count-mismatch", "regen-parse-fail", "expand-fail", "convert-fail"];
console.log("crate    | files | klines | " + STAGES.map((s) => s.padEnd(15)).join(" "));
let totals = { total: 0, lines: 0, stages: {} };
for (const [crate, c] of Object.entries(byCrate)) {
  console.log(
    crate.padEnd(8) + " | " + String(c.total).padEnd(5) + " | " + (c.lines / 1000).toFixed(1).padEnd(6) + " | " +
    STAGES.map((s) => String(c.stages[s] ?? 0).padEnd(15)).join(" "));
  totals.total += c.total;
  totals.lines += c.lines;
  for (const s of STAGES) totals.stages[s] = (totals.stages[s] ?? 0) + (c.stages[s] ?? 0);
}
console.log(
  "TOTAL".padEnd(8) + " | " + String(totals.total).padEnd(5) + " | " + (totals.lines / 1000).toFixed(1).padEnd(6) + " | " +
  STAGES.map((s) => String(totals.stages[s] ?? 0).padEnd(15)).join(" "));
const okPct = (100 * (totals.stages.equivalent ?? 0) / totals.total).toFixed(1);
console.log(`\nAST-equivalent: ${okPct}%  |  convert throughput: ${(totals.lines / (convertMs / 1000) / 1000).toFixed(0)}k lines/s (${(convertMs / 1000).toFixed(1)}s convert time for ${(totals.lines / 1000).toFixed(0)}k lines)`);

writeFileSync(join(HERE, "results.json"), JSON.stringify(results, null, 1));
console.log("details -> experiments/rust2ttm-coverage/results.json");
