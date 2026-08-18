// Summarize stage2-gate results.json: fix-round distribution, success rate,
// and token spend per model × condition, plus per-task breakdown.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const rs = JSON.parse(readFileSync(join(HERE, "results.json"), "utf8")).filter((r) => !r.error);

const models = [...new Set(rs.map((r) => r.model))];
const tasks = [...new Set(rs.map((r) => r.task))];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const outTok = (r) => (r.calls ?? []).reduce((a, c) => a + c.out, 0);
const inTok = (r) => (r.calls ?? []).reduce((a, c) => a + c.in, 0);

console.log("== per model × condition ==");
for (const m of models) {
  for (const cond of ["tatamu", "rust"]) {
    const g = rs.filter((r) => r.model === m && r.cond === cond);
    if (!g.length) continue;
    const succ = g.filter((r) => r.success);
    console.log(
      `${m.padEnd(28)} ${cond.padEnd(7)} n=${g.length}  success=${succ.length}/${g.length}  ` +
      `mean-rounds=${mean(g.map((r) => r.rounds)).toFixed(2)}  ` +
      `first-shot=${g.filter((r) => r.firstShotClean).length}  ` +
      `mean-out-tok=${Math.round(mean(g.map(outTok)))}  mean-in-tok=${Math.round(mean(g.map(inTok)))}`
    );
  }
}

console.log("\n== per task (rounds, tatamu | rust, by model+rep) ==");
for (const t of tasks) {
  const row = [t.padEnd(15)];
  for (const m of models) {
    const tt = rs.filter((r) => r.model === m && r.task === t && r.cond === "tatamu").map((r) => (r.success ? r.rounds : "X"));
    const rr = rs.filter((r) => r.model === m && r.task === t && r.cond === "rust").map((r) => (r.success ? r.rounds : "X"));
    row.push(`${m.split("-")[1]}: T[${tt.join(",")}] R[${rr.join(",")}]`);
  }
  console.log(row.join("  "));
}

console.log("\n== paired comparison (same model+task+rep) ==");
let tWins = 0, rWins = 0, ties = 0;
const pairs = [];
for (const m of models) for (const t of tasks) {
  const reps = [...new Set(rs.filter((r) => r.model === m && r.task === t).map((r) => r.rep))];
  for (const rep of reps) {
    const a = rs.find((r) => r.model === m && r.task === t && r.rep === rep && r.cond === "tatamu");
    const b = rs.find((r) => r.model === m && r.task === t && r.rep === rep && r.cond === "rust");
    if (!a || !b) continue;
    pairs.push([a.rounds, b.rounds]);
    if (a.rounds < b.rounds) tWins++;
    else if (a.rounds > b.rounds) rWins++;
    else ties++;
  }
}
console.log(`pairs=${pairs.length}  tatamu-fewer-rounds=${tWins}  rust-fewer-rounds=${rWins}  tie=${ties}`);
console.log(`mean rounds: tatamu=${mean(pairs.map((p) => p[0])).toFixed(2)}  rust=${mean(pairs.map((p) => p[1])).toFixed(2)}`);
