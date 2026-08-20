// Blind/large-scale lens experiment (follow-up to docs/39, harsher on 3 axes):
//
//   * corpus: full memchr crate (45 files, ~10x once_cell, SAFETY-heavy)
//   * free-form answers judged against reference facts (no MC option bias)
//   * three conditions:
//       blind : stripped code only — sidecars never mentioned, no tools
//       lens  : stripped code + logged ./notes + ./owners tools
//       full  : original code with comments, no tools
//
// The blind-vs-lens delta on doc-only questions measures what the sidecar
// actually carries; blind-vs-full bounds the cost of losing comments outright.
//
// usage: node experiments/lens-blind/run.mjs [--models m1,m2] [--conds ...]
//        [--ids ...] --crate <memchr checkout> [--out file]

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, cpSync, rmSync, existsSync, chmodSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QUESTIONS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const WORK = process.env.TMPDIR ? join(process.env.TMPDIR, "lens-blind") : "/tmp/claude/lens-blind";
mkdirSync(WORK, { recursive: true });

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : dflt;
};
const MODELS = argOf("--models", "claude-haiku-4-5-20251001,claude-sonnet-5").split(",");
const CONDS = argOf("--conds", "blind,lens,full").split(",");
const IDS = argOf("--ids", null)?.split(",");
const CRATE_SRC = argOf("--crate", null);
const OUT = argOf("--out", join(HERE, "results.json"));
const JUDGE_MODEL = argOf("--judge", "claude-sonnet-5");
const TATAMU = join(ROOT, "tool/target/release/tatamu");

if (!CRATE_SRC || !existsSync(join(CRATE_SRC, "src/lib.rs"))) {
  console.error("pass --crate <path-to-memchr-checkout>");
  process.exit(1);
}

// ---- prep ----
const SRC = join(WORK, "src");
rmSync(SRC, { recursive: true, force: true });
cpSync(join(CRATE_SRC, "src"), SRC, { recursive: true });
const STRIPPED = join(WORK, "stripped");
rmSync(STRIPPED, { recursive: true, force: true });
execFileSync(TATAMU, ["strip", SRC, STRIPPED], { stdio: ["ignore", "ignore", "pipe"] });

function rsFiles(dir, prefix = "") {
  const out = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...rsFiles(p, `${prefix}${e}/`));
    else if (e.endsWith(".rs")) out.push(`${prefix}${e}`);
  }
  return out;
}
const FILES = rsFiles(SRC);

// --variant tweaks the lens instructions (docs/40 finding #3 follow-up):
//   plain  (default): "use only if you actually need it"
//   guided : nudge — rationale/why questions should fetch notes first
//   forced : must run ./notes at least once before answering
const VARIANT = argOf("--variant", "plain");
function contextBlock(cond) {
  const base = cond === "full" ? SRC : STRIPPED;
  const lensTail = {
    plain: `Use these only if you actually need the externalized documentation.`,
    guided: `IMPORTANT: the code is correct but its "why" lives in the sidecars. If a question asks about rationale, design decisions, trade-offs, or anything a comment would explain, run \`./notes\` on the relevant item(s) FIRST and base your answer on what it returns. Only skip fetching when the answer is plainly visible in the code itself.`,
    forced: `You MUST run \`./notes\` at least once on the item(s) the question concerns before answering, and base your answer on what it returns.`,
  }[VARIANT];
  const intro =
    cond === "lens"
      ? `The codebase below is the \`memchr\` Rust crate with all comments and docs EXTERNALIZED into sidecar ledgers. The code is byte-identical to the original except that comments and docs were moved out. You can retrieve them on demand with shell commands:
- \`./owners\` — list every item with its file and line range
- \`./notes <name>\` — print the docs and inline comments for one item (suffix match, e.g. \`./notes find_raw\`). Use a file stem for module-level docs (e.g. \`./notes searcher\`).
${lensTail}`
      : `The codebase below is the \`memchr\` Rust crate.`;
  const body = FILES.map((f) => `## src/${f}\n\`\`\`rust\n${readFileSync(join(base, f), "utf8")}\`\`\``).join("\n\n");
  return `${intro}\n\n# Codebase\n\n${body}`;
}
const CTX = Object.fromEntries(CONDS.map((c) => [c, contextBlock(c)]));
for (const c of CONDS) console.log(`context[${c}]: ${(CTX[c].length / 1024).toFixed(0)} KB`);

let seq = 0;
function agentDir(cond) {
  const dir = join(WORK, "agents", `a${seq++}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (cond === "lens") {
    const mk = (name, cmd) => {
      const p = join(dir, name);
      writeFileSync(p, `#!/bin/sh\necho "${name} $*" >> "$(dirname "$0")/calls.log"\nexec ${cmd} "$@"\n`);
      chmodSync(p, 0o755);
    };
    mk("notes", `"${TATAMU}" notes "${STRIPPED}"`);
    mk("owners", `"${TATAMU}" owners "${STRIPPED}"`);
    writeFileSync(join(dir, "calls.log"), "");
  }
  return dir;
}

function llm(model, prompt, cond, cwd) {
  // prompt goes via stdin: a full-crate context blows the OS ARG_MAX as argv
  const cliArgs = ["-p", "--model", model, "--output-format", "json", "--max-turns", "12"];
  if (cond === "lens") cliArgs.push("--allowedTools", "Bash(./notes:*),Bash(./owners:*)");
  const r = spawnSync("claude", cliArgs, {
    encoding: "utf8", timeout: 900000, maxBuffer: 32 * 1024 * 1024, cwd, input: prompt,
    env: { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000" },
  });
  if (r.status !== 0 && !r.stdout) throw new Error(`claude failed: ${r.stderr?.slice(0, 500)}`);
  const d = JSON.parse(r.stdout);
  const u = d.usage ?? {};
  return {
    text: d.result ?? "",
    turns: d.num_turns ?? 1,
    tokens: { in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), out: u.output_tokens ?? 0 },
    cost: d.total_cost_usd ?? 0,
  };
}

const readCalls = (dir) => {
  try {
    return readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

function parseAnswer(text) {
  const t = text.trim().replace(/^```[a-z]*\n?|\n?```$/g, "").trim();
  for (const cand of [t, t.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!cand) continue;
    try {
      const o = JSON.parse(cand);
      if (o && typeof o === "object" && "answer" in o) return String(o.answer).trim();
    } catch { /* try next */ }
  }
  return t.slice(0, 1200);
}

function judge(q, answer) {
  const prompt = `You are grading a free-form answer about the memchr Rust crate. Grade STRICTLY against the rubric.

# Question
${q.q}

# Reference answer (ground truth from the crate's own comments)
${q.reference}

# Rubric
${q.rubric}

# Candidate answer
${answer}

Reply with ONLY a JSON object: {"correct": true|false, "why": "<one short sentence>"}.`;
  const r = spawnSync("claude", ["-p", prompt, "--model", JUDGE_MODEL, "--output-format", "json"],
    { encoding: "utf8", timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
  const d = JSON.parse(r.stdout);
  const t = (d.result ?? "").trim().replace(/^```[a-z]*\n?|\n?```$/g, "");
  try {
    const o = JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] ?? t);
    return { correct: !!o.correct, why: String(o.why ?? "").slice(0, 200), cost: d.total_cost_usd ?? 0 };
  } catch {
    return { correct: false, why: `judge-parse-fail: ${t.slice(0, 120)}`, cost: d.total_cost_usd ?? 0 };
  }
}

// ---- main loop: cond-major order to maximize prompt-cache reuse ----
const results = [];
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 1));

for (const model of MODELS) {
  const short = model.includes("haiku") ? "haiku" : model.includes("sonnet") ? "sonnet" : model;
  for (const cond of CONDS) {
    for (const q of QUESTIONS) {
      if (IDS && !IDS.includes(q.id)) continue;
      const dir = agentDir(cond);
      const prompt = `${CTX[cond]}\n\n# Question\n\n${q.q}\n\nReply with ONLY a JSON object of the form {"answer": "<your answer>"} — no other text.`;
      const t0 = Date.now();
      const res = llm(model, prompt, cond, dir);
      const answer = parseAnswer(res.text);
      const j = judge(q, answer);
      const rec = {
        type: "q", model: short, cond, variant: VARIANT, id: q.id, kind: q.kind,
        correct: j.correct, judgeWhy: j.why, answer: answer.slice(0, 600),
        notesCalls: readCalls(dir), turns: res.turns,
        tokens: res.tokens, cost: res.cost + j.cost, secs: (Date.now() - t0) / 1000,
      };
      results.push(rec);
      save();
      console.log(`[${short}/${cond}] ${q.id}: ${j.correct ? "OK" : "WRONG"} notes=${rec.notesCalls.length} turns=${res.turns} (${j.why.slice(0, 80)})`);
    }
  }
}

save();
console.log(`\nwrote ${OUT} (${results.length} records)`);
