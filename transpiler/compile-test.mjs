// Compile-test the whole corpus with rustc:
//   A) 29 Tatamu programs (5 hand-written + 24 LLM-generated) → transpile → rustc
//   B) 24 LLM-generated plain-Rust control programs → rustc directly
//
// rustc is invoked with --emit=metadata (type-check without codegen) for speed.
// Errors are bucketed: E0282/E0283/E0284 = type-inference (known S7 limitation),
// anything else = real failure.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { transpile } from "./tatamuc.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(process.env.TMPDIR ?? "/tmp", "tatamu-compile-test");
mkdirSync(OUT, { recursive: true });

const extract = (md) => {
  const programs = {};
  const re = /###\s+(\w+)\s*\n+```[a-z]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) programs[m[1]] = m[2];
  return programs;
};

// optional argv[2]: outputs dir (default round-1 outputs + hand-written samples)
const argDir = process.argv[2];
const cases = [];
if (!argDir) {
  const ttmDir = join(ROOT, "experiments/paper-prototype/tatamu");
  for (const f of readdirSync(ttmDir).filter((f) => f.endsWith(".ttm"))) {
    cases.push({ id: `hand/${f.replace(".ttm", "")}`, kind: "tatamu", src: readFileSync(join(ttmDir, f), "utf8") });
  }
}
const genDir = argDir ? join(process.cwd(), argDir) : join(ROOT, "experiments/llm-generation/outputs");
for (const f of argDir ? readdirSync(genDir).filter((f) => f.endsWith(".ttm")) : []) {
  cases.push({ id: f.replace(".ttm", ""), kind: "tatamu", src: readFileSync(join(genDir, f), "utf8") });
}
for (const f of readdirSync(genDir).filter((f) => f.endsWith(".md"))) {
  const [model, cond] = f.replace(".md", "").split("-");
  for (const [task, src] of Object.entries(extract(readFileSync(join(genDir, f), "utf8")))) {
    cases.push({ id: `${model}/${task}`, kind: cond, src });
  }
}

const INFERENCE_CODES = ["E0282", "E0283", "E0284", "E0790"];
const results = [];
for (const c of cases) {
  let rust;
  try {
    rust = c.kind === "tatamu" ? transpile(c.src) : c.src;
  } catch (e) {
    results.push({ ...c, status: "transpile-error", detail: e.message });
    continue;
  }
  const file = join(OUT, `${c.kind}-${c.id.replace("/", "_")}.rs`);
  writeFileSync(file, rust);
  const r = spawnSync("rustc", ["--edition", "2021", "--emit=metadata", "--crate-name", "t", "--out-dir", OUT, file],
    { encoding: "utf8", timeout: 60000 });
  if (r.status === 0) {
    results.push({ ...c, status: "ok" });
  } else {
    const codes = [...new Set((r.stderr.match(/E\d{4}/g) ?? []))];
    const onlyInference = codes.length > 0 && codes.every((code) => INFERENCE_CODES.includes(code));
    results.push({
      ...c,
      status: onlyInference ? "inference-only" : "error",
      codes,
      firstError: (r.stderr.split("\n").find((l) => l.startsWith("error")) ?? "").slice(0, 120),
    });
  }
}

// summary
const byKind = {};
for (const r of results) {
  const k = (byKind[r.kind] ??= { ok: 0, inference: 0, error: 0, total: 0 });
  k.total++;
  if (r.status === "ok") k.ok++;
  else if (r.status === "inference-only") k.inference++;
  else k.error++;
}
console.log("kind    | ok  | inference-only | other errors | total");
for (const [k, v] of Object.entries(byKind)) {
  console.log(`${k.padEnd(7)} | ${String(v.ok).padEnd(3)} | ${String(v.inference).padEnd(14)} | ${String(v.error).padEnd(12)} | ${v.total}`);
}
console.log("\nfailures:");
for (const r of results.filter((r) => r.status !== "ok")) {
  console.log(`${r.status.padEnd(15)} ${r.kind.padEnd(7)} ${r.id.padEnd(20)} ${(r.codes ?? []).join(",").padEnd(14)} ${r.firstError ?? r.detail ?? ""}`);
}
writeFileSync(join(HERE, "compile-results.json"), JSON.stringify(results, null, 2));
