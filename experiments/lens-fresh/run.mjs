// Fresh-context lens experiment (docs/35 concern #3).
//
// A model gets the once_cell codebase in context and answers questions /
// performs modifications. Two conditions:
//
//   stripped : comment-externalized code in context + on-demand `./notes`
//              (and `./owners`) commands backed by the sidecar ledgers.
//              Tool invocations are logged -> sidecar reference frequency.
//   full     : the original code (comments included) in context, no tools.
//
// Measures: accuracy (12 MC questions, half doc-only / half code-derivable),
// modification success (build+behavior, max 2 fix rounds), tokens, cost, and
// how often the model actually reaches for the sidecar.
//
// usage: node experiments/lens-fresh/run.mjs [--models m1,m2] [--only q|mod]
//        [--ids a,b] [--conds stripped,full] [--crate path] [--out file]

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, cpSync, rmSync, existsSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QUESTIONS, MODS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const WORK = process.env.TMPDIR ? join(process.env.TMPDIR, "lens-fresh") : "/tmp/claude/lens-fresh";
mkdirSync(WORK, { recursive: true });

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : dflt;
};
const MODELS = argOf("--models", "claude-haiku-4-5-20251001,claude-sonnet-5").split(",");
const ONLY = argOf("--only", null);
const IDS = argOf("--ids", null)?.split(",");
const CONDS = argOf("--conds", "stripped,full").split(",");
const CRATE_SRC = argOf("--crate", null);
const OUT = argOf("--out", join(HERE, "results.json"));
const TATAMU = join(ROOT, "tool/target/release/tatamu");
const CARGO_ENV = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:${process.env.PATH}` };

if (!CRATE_SRC || !existsSync(join(CRATE_SRC, "src/lib.rs"))) {
  console.error("pass --crate <path-to-once_cell-checkout>");
  process.exit(1);
}

// ---- prep: pristine crate copy + stripped view ----
const CRATE = join(WORK, "crate");
rmSync(CRATE, { recursive: true, force: true });
mkdirSync(CRATE, { recursive: true });
// minimal manifest: the upstream one declares examples/benches we don't copy
writeFileSync(
  join(CRATE, "Cargo.toml"),
  `[package]\nname = "once_cell"\nversion = "1.0.0"\nedition = "2021"\n\n[features]\ndefault = ["std"]\nstd = ["alloc"]\nalloc = ["race"]\nrace = []\n`
);
cpSync(join(CRATE_SRC, "src"), join(CRATE, "src"), { recursive: true });

const STRIPPED = join(WORK, "stripped");
rmSync(STRIPPED, { recursive: true, force: true });
execFileSync(TATAMU, ["strip", join(CRATE, "src"), STRIPPED], { stdio: ["ignore", "ignore", "pipe"] });

const FILES = ["lib", "race", "imp_std", "imp_pl", "imp_cs"];
const srcOf = (dir, ext) => Object.fromEntries(FILES.map((f) => [f, readFileSync(join(dir, `${f}.${ext}`), "utf8")]));
const fullFiles = srcOf(join(CRATE, "src"), "rs");
const strippedFiles = srcOf(STRIPPED, "rs");

function contextBlock(cond) {
  const files = cond === "stripped" ? strippedFiles : fullFiles;
  const intro = cond === "stripped"
    ? `The codebase below is the \`once_cell\` Rust crate with all comments and docs EXTERNALIZED into sidecar ledgers. The code is byte-identical to the original except that comments and docs were moved out. You can retrieve them on demand with shell commands:
- \`./owners\` — list every item with its file and line range
- \`./notes <name>\` — print the docs and inline comments for one item (suffix match, e.g. \`./notes get_or_try_init\`). Use a file stem for module-level docs (e.g. \`./notes race\`).
Use these only if you actually need the externalized documentation.`
    : `The codebase below is the \`once_cell\` Rust crate.`;
  const body = FILES.map((f) => `## src/${f}.rs\n\`\`\`rust\n${files[f]}\`\`\``).join("\n\n");
  return `${intro}\n\n# Codebase\n\n${body}`;
}
const CTX = Object.fromEntries(CONDS.map((c) => [c, contextBlock(c)]));

// ---- agent dir with logging tool wrappers ----
let seq = 0;
function agentDir(cond) {
  const dir = join(WORK, "agents", `a${seq++}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (cond === "stripped") {
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
  const cliArgs = ["-p", prompt, "--model", model, "--output-format", "json", "--max-turns", "12"];
  if (cond === "stripped") cliArgs.push("--allowedTools", "Bash(./notes:*),Bash(./owners:*)");
  const r = spawnSync("claude", cliArgs, { encoding: "utf8", timeout: 900000, maxBuffer: 32 * 1024 * 1024, cwd });
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
      if (o && typeof o === "object" && "answer" in o) return String(o.answer).trim().toUpperCase().slice(0, 1);
    } catch { /* try next */ }
  }
  const m = t.match(/\b([A-D])\b/);
  return m ? m[1] : "?";
}

function extractCode(text) {
  const blocks = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)];
  if (blocks.length) return blocks[blocks.length - 1][1];
  return text.trim();
}

// ---- modification judging ----
function judge(mod, code, tag) {
  const work = join(WORK, "mods", tag);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "fx", "src"), { recursive: true });
  cpSync(CRATE, join(work, "crate"), { recursive: true });
  writeFileSync(join(work, "crate", "src", `${mod.target}.rs`), code);
  writeFileSync(
    join(work, "fx", "Cargo.toml"),
    `[package]\nname = "fx"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies]\nonce_cell = { path = "../crate" }\n\n[workspace]\n`
  );
  writeFileSync(join(work, "fx", "src", "main.rs"), mod.fixture_main);
  const env = { ...CARGO_ENV, CARGO_TARGET_DIR: join(WORK, "target-shared") };
  const b = spawnSync("cargo", ["build", "--quiet", "--manifest-path", join(work, "fx", "Cargo.toml")], { encoding: "utf8", timeout: 300000, env });
  if (b.status !== 0) return { ok: false, feedback: `cargo build failed:\n${(b.stderr ?? "").slice(0, 6000)}` };
  const r = spawnSync(join(WORK, "target-shared", "debug", "fx"), [], { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0 || !(r.stdout ?? "").includes("OK")) {
    return { ok: false, feedback: `Build succeeded, but the behavior test failed (exit ${r.status}):\n${(r.stdout ?? "").slice(0, 1000)}\n${(r.stderr ?? "").slice(0, 3000)}` };
  }
  return { ok: true };
}

// ---- main loop ----
const results = [];
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 1));

for (const model of MODELS) {
  const short = model.includes("haiku") ? "haiku" : model.includes("sonnet") ? "sonnet" : model;

  if (ONLY !== "mod") {
    for (const q of QUESTIONS) {
      if (IDS && !IDS.includes(q.id)) continue;
      for (const cond of CONDS) {
        const dir = agentDir(cond);
        const prompt = `${CTX[cond]}\n\n# Question\n\n${q.q}\n\nReply with ONLY a JSON object of the form {"answer": "<letter>"} — no explanation.`;
        const t0 = Date.now();
        const res = llm(model, prompt, cond, dir);
        const got = parseAnswer(res.text);
        const rec = {
          type: "q", model: short, cond, id: q.id, kind: q.kind,
          got, want: q.answer, correct: got === q.answer,
          notesCalls: readCalls(dir), turns: res.turns,
          tokens: res.tokens, cost: res.cost, secs: (Date.now() - t0) / 1000,
        };
        results.push(rec);
        save();
        console.log(`[${short}/${cond}] ${q.id}: ${rec.correct ? "OK" : `WRONG (${got}!=${q.answer})`} turns=${rec.turns} notes=${rec.notesCalls.length} out=${res.tokens.out}`);
      }
    }
  }

  if (ONLY !== "q") {
    for (const mod of MODS) {
      if (IDS && !IDS.includes(mod.id)) continue;
      for (const cond of CONDS) {
        const dir = agentDir(cond);
        const t0 = Date.now();
        let prompt = `${CTX[cond]}\n\n# Task\n\n${mod.task}\n\nOutput the COMPLETE modified \`src/${mod.target}.rs\` file in a single \`\`\`rust code block. No other code blocks, no partial diffs.`;
        let rounds = 0, ok = false, allCalls = [], totTok = { in: 0, out: 0 }, totCost = 0, totTurns = 0, lastFeedback = null;
        while (rounds < 3) {
          const res = llm(model, prompt, cond, dir);
          totTok.in += res.tokens.in; totTok.out += res.tokens.out; totCost += res.cost; totTurns += res.turns;
          const code = extractCode(res.text);
          const j = judge(mod, code, `${short}-${cond}-${mod.id}-r${rounds}`);
          rounds++;
          if (j.ok) { ok = true; break; }
          lastFeedback = j.feedback;
          prompt = `${CTX[cond]}\n\n# Task\n\n${mod.task}\n\nYour previous attempt:\n\`\`\`rust\n${code}\n\`\`\`\n\nIt failed:\n${j.feedback}\n\nOutput the COMPLETE corrected \`src/${mod.target}.rs\` file in a single \`\`\`rust code block.`;
        }
        allCalls = readCalls(dir);
        const rec = {
          type: "mod", model: short, cond, id: mod.id,
          ok, rounds, notesCalls: allCalls, turns: totTurns,
          tokens: totTok, cost: totCost, secs: (Date.now() - t0) / 1000,
          lastFeedback: ok ? null : lastFeedback?.slice(0, 500),
        };
        results.push(rec);
        save();
        console.log(`[${short}/${cond}] ${mod.id}: ${ok ? `OK in ${rounds} round(s)` : "FAILED"} notes=${allCalls.length} out=${totTok.out}`);
      }
    }
  }
}

save();
console.log(`\nwrote ${OUT} (${results.length} records)`);
