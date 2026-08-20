// Judge sanity: reference solutions must pass, the unmodified file must fail.
// usage: node experiments/lens-fresh/sanity.mjs --crate <once_cell path>
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(process.env.TMPDIR ?? "/tmp/claude", "lens-fresh-sanity");
const CRATE_SRC = process.argv[process.argv.indexOf("--crate") + 1];
const CARGO_ENV = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:${process.env.PATH}` };

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const CRATE = join(WORK, "crate-src");
mkdirSync(CRATE, { recursive: true });
writeFileSync(
  join(CRATE, "Cargo.toml"),
  `[package]\nname = "once_cell"\nversion = "1.0.0"\nedition = "2021"\n\n[features]\ndefault = ["std"]\nstd = ["alloc"]\nalloc = ["race"]\nrace = []\n`
);
cpSync(join(CRATE_SRC, "src"), join(CRATE, "src"), { recursive: true });

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
  if (b.status !== 0) return { ok: false, why: `build: ${(b.stderr ?? "").slice(0, 800)}` };
  const r = spawnSync(join(WORK, "target-shared", "debug", "fx"), [], { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0 || !(r.stdout ?? "").includes("OK")) return { ok: false, why: `run: exit ${r.status} ${(r.stderr ?? "").slice(0, 400)}` };
  return { ok: true };
}

const orig = readFileSync(join(CRATE, "src/race.rs"), "utf8");

// reference M1: three top-level impls appended + one method inside OnceBox's impl
let ref1 = orig + `
impl OnceNonZeroUsize {
    pub fn is_initialized(&self) -> bool { self.get().is_some() }
}
impl OnceBool {
    pub fn is_initialized(&self) -> bool { self.get().is_some() }
}
impl<'a, T> OnceRef<'a, T> {
    pub fn is_initialized(&self) -> bool { self.get().is_some() }
}
`;
ref1 = ref1.replace("    impl<T> OnceBox<T> {\n", "    impl<T> OnceBox<T> {\n        pub fn is_initialized(&self) -> bool { self.get().is_some() }\n");

// reference M2: into_inner via ManuallyDrop inside the OnceBox impl
const ref2 = orig.replace(
  "    impl<T> OnceBox<T> {\n",
  `    impl<T> OnceBox<T> {
        pub fn into_inner(self) -> Option<Box<T>> {
            let this = core::mem::ManuallyDrop::new(self);
            let ptr = this.inner.load(Ordering::Acquire);
            if ptr.is_null() { None } else { Some(unsafe { Box::from_raw(ptr) }) }
        }
`
);

for (const [mod, code, expect] of [
  [MODS[0], ref1, true],
  [MODS[1], ref2, true],
  [MODS[0], orig, false],
  [MODS[1], orig, false],
]) {
  const r = judge(mod, code, `${mod.id}-${expect ? "ref" : "orig"}`);
  const pass = r.ok === expect;
  console.log(`${mod.id} expect=${expect ? "pass" : "fail"}: ${pass ? "SANE" : "BROKEN"} ${r.why ? r.why.split("\n")[0].slice(0, 120) : ""}`);
  if (!pass) process.exitCode = 1;
}
