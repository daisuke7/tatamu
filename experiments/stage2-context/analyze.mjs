// Summarize stage2-context results: comprehension accuracy, modification success,
// and paired token deltas (rust − ttm) per model × condition.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = process.argv[2] ?? join(HERE, "results.json");
const rs = JSON.parse(readFileSync(FILE, "utf8")).filter((r) => !r.error);

const models = [...new Set(rs.map((r) => r.model))];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const inTok = (r) => (r.calls ?? []).reduce((a, c) => a + c.in, 0);
const outTok = (r) => (r.calls ?? []).reduce((a, c) => a + c.out, 0);

console.log("== comprehension: accuracy per model × condition ==");
for (const m of models) {
  for (const cond of ["ttm", "rust"]) {
    const g = rs.filter((r) => r.kind === "q" && r.model === m && r.cond === cond);
    if (!g.length) continue;
    const ok = g.filter((r) => r.correct).length;
    console.log(`${m.padEnd(28)} ${cond.padEnd(5)} correct ${ok}/${g.length}  mean-in ${Math.round(mean(g.map(inTok)))}  mean-out ${Math.round(mean(g.map(outTok)))}  cost $${mean(g.map((r) => r.cost ?? 0)).toFixed(3)}/q`);
  }
}

console.log("\n== comprehension: per-question (correct count over reps) ==");
const qids = [...new Set(rs.filter((r) => r.kind === "q").map((r) => r.id))];
for (const id of qids) {
  const row = [id.padEnd(17)];
  for (const m of models) {
    for (const cond of ["ttm", "rust"]) {
      const g = rs.filter((r) => r.kind === "q" && r.model === m && r.cond === cond && r.id === id);
      row.push(`${m.split("-")[1]}/${cond}:${g.filter((r) => r.correct).length}/${g.length}`);
    }
  }
  console.log(row.join("  "));
}

console.log("\n== modification: success / rounds ==");
for (const m of models) {
  for (const cond of ["ttm", "rust"]) {
    const g = rs.filter((r) => r.kind === "mod" && r.model === m && r.cond === cond);
    if (!g.length) continue;
    const ok = g.filter((r) => r.success);
    console.log(`${m.padEnd(28)} ${cond.padEnd(5)} success ${ok.length}/${g.length}  mean-rounds ${mean(g.map((r) => r.rounds)).toFixed(2)}  mean-out ${Math.round(mean(g.map(outTok)))}`);
  }
}
console.log("\n== modification: per-task ==");
const mids = [...new Set(rs.filter((r) => r.kind === "mod").map((r) => r.id))];
for (const id of mids) {
  const row = [id.padEnd(12)];
  for (const m of models) {
    for (const cond of ["ttm", "rust"]) {
      const g = rs.filter((r) => r.kind === "mod" && r.model === m && r.cond === cond && r.id === id);
      row.push(`${m.split("-")[1]}/${cond}:[${g.map((r) => (r.success ? r.rounds : "X")).join(",")}]`);
    }
  }
  console.log(row.join("  "));
}

console.log("\n== paired input-token delta (rust − ttm), same model/id/rep ==");
for (const m of models) {
  const deltas = [];
  for (const kind of ["q", "mod"]) {
    const ids = [...new Set(rs.filter((r) => r.kind === kind && r.model === m).map((r) => r.id))];
    for (const id of ids) {
      const reps = [...new Set(rs.filter((r) => r.kind === kind && r.model === m && r.id === id).map((r) => r.rep))];
      for (const rep of reps) {
        const a = rs.find((r) => r.kind === kind && r.model === m && r.id === id && r.rep === rep && r.cond === "ttm");
        const b = rs.find((r) => r.kind === kind && r.model === m && r.id === id && r.rep === rep && r.cond === "rust");
        if (a && b && a.calls?.length === 1 && b.calls?.length === 1) deltas.push(inTok(b) - inTok(a));
      }
    }
  }
  console.log(`${m.padEnd(28)} single-call pairs=${deltas.length}  mean delta ${Math.round(mean(deltas))} tokens (positive = rust context larger)`);
}
