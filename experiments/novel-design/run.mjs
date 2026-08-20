// Novel-design experiment (docs/41 follow-up): implement functions whose
// spec exists ONLY in docs — no adjacent implementation to imitate.
//
//   blind : stripped corvid crate, sidecars never mentioned, no tools
//   lens  : stripped + ./notes,./owners with fetch-first wording
//   full  : original code with the spec docs inline
//
// Scoring is per test vector (partial credit); fix rounds only for build
// errors (max 2 extra), spec mismatches are terminal with no detail leaked.
//
// usage: node experiments/novel-design/run.mjs [--models ...] [--conds ...]
//        [--ids ...] [--out file]

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, cpSync, rmSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const WORK = process.env.TMPDIR ? join(process.env.TMPDIR, "novel-design") : "/tmp/claude/novel-design";
mkdirSync(WORK, { recursive: true });

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : dflt;
};
const MODELS = argOf("--models", "claude-haiku-4-5-20251001,claude-sonnet-5").split(",");
const CONDS = argOf("--conds", "blind,lens,full").split(",");
const IDS = argOf("--ids", null)?.split(",");
const OUT = argOf("--out", join(HERE, "results.json"));
const TATAMU = join(ROOT, "tool/target/release/tatamu");
const CARGO_ENV = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:${process.env.PATH}` };

// ---- prep ----
const CRATE = join(WORK, "crate");
rmSync(CRATE, { recursive: true, force: true });
mkdirSync(CRATE, { recursive: true });
cpSync(join(HERE, "corvid/Cargo.toml"), join(CRATE, "Cargo.toml"));
cpSync(join(HERE, "corvid/src"), join(CRATE, "src"), { recursive: true });

const STRIPPED = join(WORK, "stripped");
rmSync(STRIPPED, { recursive: true, force: true });
execFileSync(TATAMU, ["strip", join(CRATE, "src"), STRIPPED], { stdio: ["ignore", "ignore", "pipe"] });

const FILES = ["lib", "frame", "varint", "session", "hexutil"];
const srcOf = (dir) => Object.fromEntries(FILES.map((f) => [f, readFileSync(join(dir, `${f}.rs`), "utf8")]));
const fullFiles = srcOf(join(CRATE, "src"));
const strippedFiles = srcOf(STRIPPED);

function contextBlock(cond) {
  const files = cond === "full" ? fullFiles : strippedFiles;
  const intro =
    cond === "lens"
      ? `The codebase below is the \`corvid\` Rust crate with all comments and docs EXTERNALIZED into sidecar ledgers. The code is byte-identical to the original except that comments and docs were moved out. You can retrieve them on demand with shell commands:
- \`./owners\` — list every item with its file and line range
- \`./notes <name>\` — print the docs for one item (suffix match, e.g. \`./notes encode_frame\`). Use a file stem for module-level docs (e.g. \`./notes frame\`).
Before writing any code you MUST consult \`./notes\` for the module and the items you are about to implement, and follow every contract documented there.`
      : `The codebase below is the \`corvid\` Rust crate.`;
  const body = FILES.map((f) => `## src/${f}.rs\n\`\`\`rust\n${files[f]}\`\`\``).join("\n\n");
  return `${intro}\n\n# Codebase\n\n${body}`;
}
const CTX = Object.fromEntries(CONDS.map((c) => [c, contextBlock(c)]));

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
  const cliArgs = ["-p", "--model", model, "--output-format", "json", "--max-turns", "14"];
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

function extractCode(text) {
  const blocks = [...text.matchAll(/^```[a-z]*\n([\s\S]*?)^``` *$/gm)].map((m) => m[1]);
  if (blocks.length) return blocks.reduce((a, b) => (b.length > a.length ? b : a));
  return text.trim();
}

// returns {gate: "build"|null, score, total, failed:[names], feedback}
export function grade(mod, code, tag) {
  const work = join(WORK, "mods", tag);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "fx", "src"), { recursive: true });
  cpSync(CRATE, join(work, "crate"), { recursive: true });
  writeFileSync(join(work, "crate", "src", `${mod.target}.rs`), code);
  writeFileSync(
    join(work, "fx", "Cargo.toml"),
    `[package]\nname = "fx"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies]\ncorvid = { path = "../crate" }\n\n[workspace]\n`
  );
  writeFileSync(join(work, "fx", "src", "main.rs"), mod.fixture_main);
  const env = { ...CARGO_ENV, CARGO_TARGET_DIR: join(WORK, "target-shared") };
  const b = spawnSync("cargo", ["build", "--quiet", "--manifest-path", join(work, "fx", "Cargo.toml")], { encoding: "utf8", timeout: 300000, env });
  if (b.status !== 0) return { gate: "build", score: 0, total: 0, failed: [], feedback: `cargo build failed:\n${(b.stderr ?? "").slice(0, 6000)}` };
  const r = spawnSync(join(WORK, "target-shared", "debug", "fx"), [], { encoding: "utf8", timeout: 60000 });
  const out = r.stdout ?? "";
  const m = out.match(/SCORE (\d+)\/(\d+)/);
  const failed = [...out.matchAll(/^FAIL (\S+)/gm)].map((x) => x[1]);
  if (!m) return { gate: "build", score: 0, total: 0, failed, feedback: `fixture crashed (exit ${r.status}):\n${out.slice(0, 800)}\n${(r.stderr ?? "").slice(0, 800)}` };
  return { gate: null, score: parseInt(m[1], 10), total: parseInt(m[2], 10), failed, feedback: null };
}

// ---- main loop ----
const results = [];
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 1));

if (process.env.NOVEL_DESIGN_LIB !== "1") {
  for (const model of MODELS) {
    const short = model.includes("haiku") ? "haiku" : model.includes("sonnet") ? "sonnet" : model;
    for (const cond of CONDS) {
      for (const mod of MODS) {
        if (IDS && !IDS.includes(mod.id)) continue;
        const dir = agentDir(cond);
        const t0 = Date.now();
        let prompt = `${CTX[cond]}\n\n# Task\n\n${mod.task}\n\nOutput the COMPLETE modified \`src/${mod.target}.rs\` file in a single \`\`\`rust code block. No other code blocks, no partial diffs.`;
        let rounds = 0, g = null, totTok = { in: 0, out: 0 }, totCost = 0, totTurns = 0;
        while (rounds < 3) {
          const res = llm(model, prompt, cond, dir);
          totTok.in += res.tokens.in; totTok.out += res.tokens.out; totCost += res.cost; totTurns += res.turns;
          const code = extractCode(res.text);
          g = grade(mod, code, `${short}-${cond}-${mod.id}-r${rounds}`);
          rounds++;
          if (g.gate !== "build") break; // scored (spec mismatches are terminal)
          prompt = `${CTX[cond]}\n\n# Task\n\n${mod.task}\n\nYour previous attempt:\n\`\`\`rust\n${code}\n\`\`\`\n\nIt failed to build:\n${g.feedback}\n\nOutput the COMPLETE corrected \`src/${mod.target}.rs\` file in a single \`\`\`rust code block.`;
        }
        const rec = {
          type: "mod", model: short, cond, id: mod.id,
          score: g.score, total: g.total, perfect: g.gate === null && g.score === g.total,
          gate: g.gate, failed: g.failed, rounds, notesCalls: readCalls(dir), turns: totTurns,
          tokens: totTok, cost: totCost, secs: (Date.now() - t0) / 1000,
        };
        results.push(rec);
        save();
        console.log(`[${short}/${cond}] ${mod.id}: ${g.gate === "build" ? "BUILD-FAIL" : `${g.score}/${g.total}`} notes=${rec.notesCalls.length}`);
      }
    }
  }
  save();
  console.log(`\nwrote ${OUT} (${results.length} records)`);
}
