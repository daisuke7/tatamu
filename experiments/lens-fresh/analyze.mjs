// Summarize lens-fresh results: accuracy by kind/condition, notes usage,
// tokens and cost.
// usage: node experiments/lens-fresh/analyze.mjs [results.json]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const results = JSON.parse(readFileSync(process.argv[2] ?? join(HERE, "results.json"), "utf8"));

const qs = results.filter((r) => r.type === "q");
const mods = results.filter((r) => r.type === "mod");

const models = [...new Set(results.map((r) => r.model))];
const conds = [...new Set(results.map((r) => r.cond))];

console.log("== comprehension accuracy ==");
for (const m of models) {
  for (const cond of conds) {
    for (const kind of ["doc", "code"]) {
      const set = qs.filter((r) => r.model === m && r.cond === cond && r.kind === kind);
      if (!set.length) continue;
      const ok = set.filter((r) => r.correct).length;
      const fetched = set.filter((r) => r.notesCalls.length > 0).length;
      const calls = set.reduce((a, r) => a + r.notesCalls.length, 0);
      console.log(
        `${m}/${cond}/${kind}: ${ok}/${set.length} correct, fetched on ${fetched}/${set.length} questions (${calls} calls total)`
      );
    }
  }
}

console.log("\n== per-question detail (doc questions, stripped) ==");
for (const r of qs.filter((r) => r.cond === "stripped")) {
  console.log(
    `${r.model} ${r.id} [${r.kind}]: ${r.correct ? "ok" : "WRONG"} notes=[${r.notesCalls.join("; ")}]`
  );
}

console.log("\n== modifications ==");
for (const r of mods) {
  console.log(
    `${r.model}/${r.cond} ${r.id}: ${r.ok ? `ok r${r.rounds}` : "FAILED"} notes=${r.notesCalls.length} out=${r.tokens.out}`
  );
}

console.log("\n== tokens/cost ==");
for (const m of models) {
  for (const cond of conds) {
    const set = results.filter((r) => r.model === m && r.cond === cond);
    if (!set.length) continue;
    const tin = set.reduce((a, r) => a + r.tokens.in, 0);
    const tout = set.reduce((a, r) => a + r.tokens.out, 0);
    const cost = set.reduce((a, r) => a + r.cost, 0);
    console.log(`${m}/${cond}: in=${tin} out=${tout} cost=$${cost.toFixed(2)} (${set.length} runs)`);
  }
}
const total = results.reduce((a, r) => a + r.cost, 0);
console.log(`total cost: $${total.toFixed(2)}`);
