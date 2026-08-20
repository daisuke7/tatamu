// Summarize lens-blind results: accuracy per condition/kind, blind-vs-lens
// delta per question, notes usage, cost.
// usage: node experiments/lens-blind/analyze.mjs [results.json]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const rs = JSON.parse(readFileSync(process.argv[2] ?? join(HERE, "results.json"), "utf8"));

const models = [...new Set(rs.map((r) => r.model))];
const conds = ["blind", "lens", "full"].filter((c) => rs.some((r) => r.cond === c));
const ids = [...new Set(rs.map((r) => r.id))];

console.log("== accuracy by condition/kind ==");
for (const m of models) {
  for (const cond of conds) {
    const line = ["doc", "code"].map((kind) => {
      const set = rs.filter((r) => r.model === m && r.cond === cond && r.kind === kind);
      const ok = set.filter((r) => r.correct).length;
      return `${kind} ${ok}/${set.length}`;
    });
    const fetched = rs.filter((r) => r.model === m && r.cond === cond && r.notesCalls?.length > 0).length;
    console.log(`${m}/${cond}: ${line.join(", ")}  (fetched on ${fetched} questions)`);
  }
}

console.log("\n== per-question matrix (o=correct, x=wrong; lens shows fetch count) ==");
console.log("question".padEnd(28), models.flatMap((m) => conds.map((c) => `${m[0]}-${c.slice(0, 4)}`)).join(" "));
for (const id of ids) {
  const cells = models.flatMap((m) =>
    conds.map((c) => {
      const r = rs.find((x) => x.model === m && x.cond === c && x.id === id);
      if (!r) return "  -   ";
      const mark = r.correct ? "o" : "x";
      const n = c === "lens" ? `(${r.notesCalls.length})` : "   ";
      return ` ${mark}${n} `.padEnd(7);
    })
  );
  const kind = rs.find((x) => x.id === id)?.kind;
  console.log(`${id} [${kind}]`.padEnd(28), cells.join(""));
}

console.log("\n== lens fetch detail ==");
for (const r of rs.filter((r) => r.cond === "lens" && r.notesCalls?.length)) {
  console.log(`${r.model} ${r.id}: [${r.notesCalls.join("; ")}]`);
}

console.log("\n== wrong answers ==");
for (const r of rs.filter((r) => !r.correct)) {
  console.log(`${r.model}/${r.cond} ${r.id}: ${r.judgeWhy}`);
}

console.log("\n== cost ==");
for (const m of models) {
  for (const cond of conds) {
    const set = rs.filter((r) => r.model === m && r.cond === cond);
    const cost = set.reduce((a, r) => a + r.cost, 0);
    const out = set.reduce((a, r) => a + r.tokens.out, 0);
    console.log(`${m}/${cond}: $${cost.toFixed(2)} out=${out} (${set.length} runs)`);
  }
}
console.log(`total: $${rs.reduce((a, r) => a + r.cost, 0).toFixed(2)}`);
