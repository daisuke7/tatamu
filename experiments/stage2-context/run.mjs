// Stage 2 gate retry — large-context axis.
// Does a codebase held in context as Tatamu (rules + .ttm) support the same
// comprehension/modification accuracy as the 1:1 Rust version, at fewer tokens?
//
//   condition ttm : Tatamu rules + 5 .ttm modules in context
//   condition rust: the tatamuc-generated 1:1 .rs modules in context
//
// Comprehension: 12 mechanically-graded questions (ground truth pre-verified
// against the real binary). Modification: 3 tasks judged by rebuild + behavior
// check, max 2 fix rounds.
//
// usage: node experiments/stage2-context/run.mjs [--models m1,m2] [--reps N] [--only q|mod] [--ids a,b]

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, cpSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QUESTIONS, MODS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const WORK = process.env.TMPDIR ? join(process.env.TMPDIR, "stage2-context") : "/tmp/claude/stage2-context";
mkdirSync(WORK, { recursive: true });

const RULES = readFileSync(join(ROOT, "experiments/llm-generation/prompt-tatamu.md"), "utf8");
const SRC_TTM = join(ROOT, "dogfood/rust2ttm/src-ttm");
const MODULES = ["main", "items", "textual", "compare", "comments"];
const CARGO_ENV = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:${process.env.PATH}` };

// generate the 1:1 Rust baseline from the current .ttm sources
const BASE_RS = join(WORK, "tool-rs");
rmSync(BASE_RS, { recursive: true, force: true });
execFileSync("node", [join(ROOT, "transpiler/tatamuc.mjs"), "--project", SRC_TTM, BASE_RS], { stdio: ["ignore", "ignore", "pipe"] });

const ttmFiles = Object.fromEntries(MODULES.map((m) => [m, readFileSync(join(SRC_TTM, `${m}.ttm`), "utf8")]));
const rsFiles = Object.fromEntries(MODULES.map((m) => [m, readFileSync(join(BASE_RS, "src", `${m}.rs`), "utf8")]));

function contextBlock(cond) {
  const ext = cond === "ttm" ? "ttm" : "rs";
  const files = cond === "ttm" ? ttmFiles : rsFiles;
  const intro = cond === "ttm"
    ? `The codebase below is written in Tatamu, a token-efficient dialect of Rust. Dialect specification:\n\n${RULES}\n`
    : `The codebase below is written in Rust (edition 2021).\n`;
  const body = MODULES.map((m) => `## ${m}.${ext}\n\`\`\`\n${files[m]}\`\`\``).join("\n\n");
  return `${intro}\n# Codebase: rust2ttm — a CLI that converts Rust sources to the Tatamu dialect (subcommand \`convert\`) and checks normalized AST equivalence (subcommand \`compare\`)\n\n${body}`;
}
const CTX = { ttm: contextBlock("ttm"), rust: contextBlock("rust") };

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : dflt;
};
const MODELS = argOf("--models", "claude-haiku-4-5-20251001,claude-sonnet-5").split(",");
const REPS = parseInt(argOf("--reps", "2"), 10);
const ONLY = argOf("--only", null);
const IDS = argOf("--ids", null)?.split(",");
const OUT = argOf("--out", join(HERE, "results.json"));

function llm(model, prompt) {
  const out = execFileSync("claude", ["-p", prompt, "--model", model, "--output-format", "json"],
    { encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  const d = JSON.parse(out);
  const u = d.usage ?? {};
  return {
    text: d.result ?? "",
    tokens: { in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), out: u.output_tokens ?? 0 },
    cost: d.total_cost_usd ?? 0,
  };
}

function parseAnswer(text) {
  const t = text.trim().replace(/^```[a-z]*\n?|\n?```$/g, "").trim();
  for (const cand of [t, t.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!cand) continue;
    try {
      const o = JSON.parse(cand);
      if (o && typeof o === "object" && "answer" in o) return { parsed: true, answer: o.answer };
    } catch { /* try next */ }
  }
  return { parsed: false, answer: t.slice(0, 200) };
}

function extractCode(text) {
  const blocks = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)];
  if (blocks.length) return blocks[blocks.length - 1][1];
  return text.trim();
}

// ---- modification judging ----
function judge(cond, mod, code, tag) {
  const work = join(WORK, "mods", tag);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "fixture"), { recursive: true });
  for (const [name, content] of Object.entries(mod.fixtures)) writeFileSync(join(work, "fixture", name), content);

  let binDir;
  if (cond === "ttm") {
    const srcDir = join(work, "src-ttm");
    cpSync(SRC_TTM, srcDir, { recursive: true });
    writeFileSync(join(srcDir, `${mod.target}.ttm`), code);
    const cmp = spawnSync("node", [join(ROOT, "transpiler/tatamuc.mjs"), "--compile", srcDir],
      { encoding: "utf8", timeout: 300000, env: CARGO_ENV });
    try {
      const d = JSON.parse(cmp.stdout);
      if (!d.ok) {
        const errs = (d.diagnostics ?? []).filter((x) => x.severity === "error");
        return { ok: false, feedback: JSON.stringify({ tool: "tatamuc --compile (rustc mapped to .ttm lines)", diagnostics: errs.length ? errs : d.diagnostics }, null, 1).slice(0, 6000) };
      }
    } catch {
      return { ok: false, feedback: (cmp.stdout + cmp.stderr).slice(0, 6000) };
    }
    const proj = join(work, "tool");
    execFileSync("node", [join(ROOT, "transpiler/tatamuc.mjs"), "--project", srcDir, proj], { stdio: ["ignore", "ignore", "pipe"] });
    const env = { ...CARGO_ENV, CARGO_TARGET_DIR: join(WORK, "target-ttm") };
    const b = spawnSync("cargo", ["build", "--quiet", "--manifest-path", join(proj, "Cargo.toml")], { encoding: "utf8", timeout: 300000, env });
    if (b.status !== 0) return { ok: false, feedback: `cargo build failed:\n${b.stderr.slice(0, 6000)}` };
    binDir = join(WORK, "target-ttm", "debug", "tool");
  } else {
    const proj = join(work, "tool");
    mkdirSync(join(proj, "src"), { recursive: true });
    cpSync(join(BASE_RS, "Cargo.toml"), join(proj, "Cargo.toml"));
    cpSync(join(BASE_RS, "src"), join(proj, "src"), { recursive: true });
    writeFileSync(join(proj, "src", `${mod.target}.rs`), code);
    const env = { ...CARGO_ENV, CARGO_TARGET_DIR: join(WORK, "target-rs") };
    const b = spawnSync("cargo", ["build", "--quiet", "--manifest-path", join(proj, "Cargo.toml")], { encoding: "utf8", timeout: 300000, env });
    if (b.status !== 0) return { ok: false, feedback: `cargo build failed (rustc):\n${b.stderr.slice(0, 6000)}` };
    // package name comes from BASE_RS's Cargo.toml (basename of the generated dir)
    const pkg = readFileSync(join(proj, "Cargo.toml"), "utf8").match(/^name = "(.+)"/m)[1];
    binDir = join(WORK, "target-rs", "debug", pkg);
  }
  const run = (a) => {
    const r = spawnSync(binDir, a, { encoding: "utf8", timeout: 60000 });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", read: (p) => readFileSync(p, "utf8") };
  };
  const res = mod.check(run, work);
  if (!res.ok) return { ok: false, feedback: `Build succeeded, but the behavior check failed: ${res.detail}` };
  return { ok: true };
}

const results = [];
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 1));

const questions = IDS ? QUESTIONS.filter((q) => IDS.includes(q.id)) : QUESTIONS;
const mods = IDS ? MODS.filter((m) => IDS.includes(m.id)) : MODS;
const FIX_ROUNDS = 2;

for (const model of MODELS) {
  if (ONLY !== "mod") {
    for (const q of questions) {
      for (let rep = 0; rep < REPS; rep++) {
        for (const cond of ["ttm", "rust"]) {
          const t0 = Date.now();
          const prompt = `${CTX[cond]}\n\n# Question\n\n${q.q}\n\nOutput ONLY a single JSON object: {"answer": <your answer>} — no explanation, no code fences.`;
          let rec = { kind: "q", model, cond, id: q.id, rep };
          try {
            const resp = llm(model, prompt);
            const { parsed, answer } = parseAnswer(resp.text);
            rec = { ...rec, correct: parsed && !!q.grade(answer), parsed, answer, calls: [resp.tokens], cost: resp.cost };
          } catch (e) {
            rec.error = String(e).slice(0, 300);
          }
          rec.secs = Math.round((Date.now() - t0) / 1000);
          results.push(rec);
          save();
          console.log(`${model.padEnd(28)} ${cond.padEnd(5)} q:${q.id.padEnd(16)} rep${rep} → ${rec.error ? "ERROR" : rec.correct ? "ok" : `WRONG (${JSON.stringify(rec.answer).slice(0, 60)})`} ${rec.secs}s`);
        }
      }
    }
  }
  if (ONLY !== "q") {
    for (const mod of mods) {
      for (let rep = 0; rep < REPS; rep++) {
        for (const cond of ["ttm", "rust"]) {
          const t0 = Date.now();
          const ext = cond === "ttm" ? "ttm" : "rs";
          const tag = `${model.split("-")[1]}-${cond}-${mod.id}-${rep}`;
          const base = `${CTX[cond]}\n\n# Task\n\nModify the codebase as follows:\n\n${mod.task}\n\nOutput the COMPLETE modified content of the file \`${mod.target}.${ext}\` (the entire file, not a diff) in ONE fenced code block. Do not modify other files. No explanation.`;
          let rec = { kind: "mod", model, cond, id: mod.id, rep, rounds: null, success: false, calls: [], cost: 0 };
          try {
            let resp = llm(model, base);
            rec.calls.push(resp.tokens);
            rec.cost += resp.cost;
            let code = extractCode(resp.text);
            for (let round = 0; round <= FIX_ROUNDS; round++) {
              const res = judge(cond, mod, code, `${tag}-r${round}`);
              if (res.ok) {
                rec.rounds = round;
                rec.success = true;
                break;
              }
              if (round === FIX_ROUNDS) { rec.rounds = FIX_ROUNDS + 1; break; }
              const fix = `${base}\n\n# Your previous attempt\n\n\`\`\`\n${code}\n\`\`\`\n\n# Result\n\n\`\`\`\n${res.feedback}\n\`\`\`\n\nFix it. Output the COMPLETE corrected \`${mod.target}.${ext}\` in ONE fenced code block.`;
              resp = llm(model, fix);
              rec.calls.push(resp.tokens);
              rec.cost += resp.cost;
              code = extractCode(resp.text);
            }
          } catch (e) {
            rec.error = String(e).slice(0, 300);
          }
          rec.secs = Math.round((Date.now() - t0) / 1000);
          results.push(rec);
          save();
          const outTok = rec.calls.reduce((a, c) => a + c.out, 0);
          console.log(`${model.padEnd(28)} ${cond.padEnd(5)} m:${mod.id.padEnd(16)} rep${rep} → ${rec.error ? `ERROR ${rec.error}` : rec.success ? `ok rounds=${rec.rounds}` : "FAIL"} outTok=${outTok} ${rec.secs}s`);
        }
      }
    }
  }
}

console.log(`\ncontext sizes (chars): ttm=${CTX.ttm.length} rust=${CTX.rust.length}`);
console.log("done — results in " + OUT);
