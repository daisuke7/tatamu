// Diagnose one file: convert → expand → compare, show rustc-located parse errors.
// usage: node experiments/rust2ttm-coverage/diag.mjs <file.rs> [workdir]
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { transpile } from "../../transpiler/tatamuc.mjs";

const R2T = "/tmp/claude-501/rust2ttm-syn/target/release/rust2ttm-syn";
const file = process.argv[2];
const tmp = process.argv[3] ?? "/tmp/claude-501/diag-work";
rmSync(join(tmp, "in"), { recursive: true, force: true });
mkdirSync(join(tmp, "in"), { recursive: true });
writeFileSync(join(tmp, "in/mod_under_test.rs"), readFileSync(file, "utf8"));
execFileSync(R2T, ["convert", join(tmp, "in"), join(tmp, "ttm")], { stdio: "pipe" });
const regen = transpile(readFileSync(join(tmp, "ttm/mod_under_test.ttm"), "utf8"));
writeFileSync(join(tmp, "regen.rs"), regen);
const cmp = spawnSync(R2T, ["compare", file, join(tmp, "regen.rs")], { encoding: "utf8" });
if (cmp.status === 0) { console.log("EQUIVALENT"); process.exit(0); }
console.log(cmp.stdout.trim() || cmp.stderr.trim());
// locate parse errors precisely via rustc
const rc = spawnSync("rustc", ["--edition", "2024", "--crate-type", "lib", "--emit=metadata",
  "-o", join(tmp, "m.rmeta"), join(tmp, "regen.rs")], { encoding: "utf8" });
const parseErrs = rc.stderr.split("\n\n").filter((b) => /^error(\[|:)/.test(b) && !/E0(4|5|6)\d\d|E02\d\d|E03\d\d/.test(b));
console.log(parseErrs.slice(0, 3).join("\n\n"));
console.log(`\nttm: ${join(tmp, "ttm/mod_under_test.ttm")}\nregen: ${join(tmp, "regen.rs")}`);
