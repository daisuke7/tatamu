// Stage 2 gate experiment: does the Tatamu toolchain (--check structured
// diagnostics + --compile with .ttm-mapped rustc errors) improve the
// LLM fix loop over raw Rust + raw rustc stderr?
//
// Protocol (per model × condition × task × repetition):
//   round 0: generate a single-file program from the task spec
//   loop (max FIX_ROUNDS fixes):
//     Tatamu: tatamuc --check → if errors, feed JSON diagnostics back;
//             else tatamuc --compile (rustc type-check, .ttm coords) → feed JSON back
//     Rust:   rustc --emit=metadata → feed raw stderr back
//   success = clean type-check. Records rounds used, success, token usage.
//
// usage: node experiments/stage2-gate/run.mjs [--models m1,m2] [--reps N] [--tasks id,id]

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TASKS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const WORK = process.env.TMPDIR ? join(process.env.TMPDIR, "stage2-gate") : "/tmp/claude/stage2-gate";
mkdirSync(WORK, { recursive: true });

const FIX_ROUNDS = 4;
const RULES = readFileSync(join(ROOT, "experiments/llm-generation/prompt-tatamu.md"), "utf8");

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : dflt;
};
const MODELS = argOf("--models", "claude-haiku-4-5-20251001,claude-sonnet-5").split(",");
const REPS = parseInt(argOf("--reps", "2"), 10);
const TASK_FILTER = argOf("--tasks", null);
const tasks = TASK_FILTER ? TASKS.filter((t) => TASK_FILTER.split(",").includes(t.id)) : TASKS;

function llm(model, prompt) {
  const out = execFileSync("claude", ["-p", prompt, "--model", model, "--output-format", "json"],
    { encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  const d = JSON.parse(out);
  const u = d.usage ?? {};
  return {
    text: d.result ?? "",
    tokens: {
      in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      out: u.output_tokens ?? 0,
    },
    cost: d.total_cost_usd ?? 0,
  };
}

function extractCode(text) {
  const blocks = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)];
  if (blocks.length) return blocks[blocks.length - 1][1];
  return text.trim();
}

function checkTatamu(code, tag) {
  const f = join(WORK, `${tag}.ttm`);
  writeFileSync(f, code);
  const chk = spawnSync("node", [join(ROOT, "transpiler/tatamuc.mjs"), "--check", f], { encoding: "utf8" });
  try {
    const d = JSON.parse(chk.stdout);
    const errs = (d.diagnostics ?? []).filter((x) => x.severity === "error");
    if (errs.length) return { ok: false, feedback: JSON.stringify({ tool: "tatamuc --check", diagnostics: errs }, null, 1) };
  } catch { /* fall through to compile */ }
  for (let attempt = 0; attempt < 2; attempt++) {
    const cmp = spawnSync("node", [join(ROOT, "transpiler/tatamuc.mjs"), "--compile", f],
      { encoding: "utf8", timeout: 300000 });
    try {
      const d = JSON.parse(cmp.stdout);
      if (d.ok) return { ok: true };
      return { ok: false, feedback: JSON.stringify({ tool: "tatamuc --compile (rustc mapped to .ttm lines)", diagnostics: d.diagnostics }, null, 1) };
    } catch {
      if (attempt === 0) continue; // transient tool failure — retry once before judging
      return { ok: false, feedback: (cmp.stdout + cmp.stderr).slice(0, 6000) };
    }
  }
}

function checkRust(code, tag) {
  const f = join(WORK, `${tag}.rs`);
  writeFileSync(f, code);
  const rc = spawnSync("rustc", ["--edition", "2021", "--emit=metadata", "-o", join(WORK, `${tag}.rmeta`), f],
    { encoding: "utf8", timeout: 300000, env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:${process.env.PATH}` } });
  if (rc.status === 0) return { ok: true };
  return { ok: false, feedback: rc.stderr.slice(0, 8000) };
}

function genPrompt(cond, task) {
  const common = `# Task

${task.spec}

Requirements: a single self-contained file, standard library only. Output ONLY the complete program in one fenced code block — no explanation.`;
  if (cond === "tatamu") {
    return `You write code in Tatamu, a token-efficient dialect of Rust. Follow the specification below exactly.

${RULES}

${common}`;
  }
  return `You write Rust (edition 2021).

${common}`;
}

function fixPrompt(cond, task, code, feedback) {
  const lang = cond === "tatamu" ? "Tatamu (specification above still applies)" : "Rust";
  return `${genPrompt(cond, task)}

# Your previous attempt

\`\`\`
${code}
\`\`\`

# Compiler feedback

\`\`\`
${feedback}
\`\`\`

Fix the program. Output ONLY the complete corrected file in one fenced code block.`;
}

function runSeries(model, cond, task, rep) {
  const tag = `${model.split("-")[1]}-${cond}-${task.id}-${rep}`;
  const rec = { model, cond, task: task.id, rep, rounds: null, success: false, calls: [], firstShotClean: false };
  let resp = llm(model, genPrompt(cond, task));
  rec.calls.push(resp.tokens);
  let code = extractCode(resp.text);
  for (let round = 0; round <= FIX_ROUNDS; round++) {
    const res = cond === "tatamu" ? checkTatamu(code, `${tag}-r${round}`) : checkRust(code, `${tag}-r${round}`);
    if (res.ok) {
      rec.rounds = round;
      rec.success = true;
      rec.firstShotClean = round === 0;
      return rec;
    }
    if (round === FIX_ROUNDS) break;
    resp = llm(model, fixPrompt(cond, task, code, res.feedback));
    rec.calls.push(resp.tokens);
    code = extractCode(resp.text);
  }
  rec.rounds = FIX_ROUNDS + 1; // exhausted
  return rec;
}

const results = [];
for (const model of MODELS) {
  for (const task of tasks) {
    for (let rep = 0; rep < REPS; rep++) {
      for (const cond of ["tatamu", "rust"]) {
        const t0 = Date.now();
        let rec;
        try {
          rec = runSeries(model, cond, task, rep);
        } catch (e) {
          rec = { model, cond, task: task.id, rep, error: String(e).slice(0, 200) };
        }
        rec.secs = Math.round((Date.now() - t0) / 1000);
        results.push(rec);
        const outTok = (rec.calls ?? []).reduce((a, c) => a + c.out, 0);
        console.log(`${model.padEnd(28)} ${cond.padEnd(7)} ${task.id.padEnd(15)} rep${rep} → ` +
          (rec.error ? `ERROR ${rec.error}` :
            `${rec.success ? "ok" : "FAIL"} rounds=${rec.rounds} outTok=${outTok} ${rec.secs}s`));
        writeFileSync(join(HERE, "results.json"), JSON.stringify(results, null, 1));
      }
    }
  }
}

// ---- summary ----
console.log("\n== summary (fix rounds to clean compile; lower is better) ==");
for (const model of MODELS) {
  for (const cond of ["tatamu", "rust"]) {
    const rs = results.filter((r) => r.model === model && r.cond === cond && !r.error);
    const ok = rs.filter((r) => r.success);
    const mean = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "-");
    const outTok = rs.map((r) => (r.calls ?? []).reduce((a, c) => a + c.out, 0));
    console.log(`${model.padEnd(28)} ${cond.padEnd(7)} success ${ok.length}/${rs.length}  ` +
      `mean-rounds ${mean(rs.map((r) => r.rounds))}  first-shot ${rs.filter((r) => r.firstShotClean).length}  ` +
      `mean-outTok ${mean(outTok)}`);
  }
}
