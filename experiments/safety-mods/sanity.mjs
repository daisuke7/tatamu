// Grader sanity for safety-mods: reference solutions must PASS, and known
// wrong implementations must FAIL at the intended gate.
// usage: SAFETY_MODS_LIB=1 node experiments/safety-mods/sanity.mjs --crate <once_cell>
process.env.SAFETY_MODS_LIB = "1";
const { grade } = await import("./run.mjs");
const { MODS } = await import("./tasks.mjs");
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CRATE_SRC = process.argv[process.argv.indexOf("--crate") + 1];
const race = readFileSync(join(CRATE_SRC, "src/race.rs"), "utf8");
const impStd = readFileSync(join(CRATE_SRC, "src/imp_std.rs"), "utf8");

const T1_IMPL = (orderings) => `
pub struct OnceNonZeroU32 {
    inner: core::sync::atomic::AtomicU32,
}
impl OnceNonZeroU32 {
    pub const fn new() -> Self {
        Self { inner: core::sync::atomic::AtomicU32::new(0) }
    }
    pub fn get(&self) -> Option<core::num::NonZeroU32> {
        core::num::NonZeroU32::new(self.inner.load(${orderings.load}))
    }
    pub fn set(&self, value: core::num::NonZeroU32) -> Result<(), ()> {
        match self.inner.compare_exchange(0, value.get(), ${orderings.succ}, ${orderings.fail}) {
            Ok(_) => Ok(()),
            Err(_) => Err(()),
        }
    }
    pub fn get_or_init<F>(&self, f: F) -> core::num::NonZeroU32
    where F: FnOnce() -> core::num::NonZeroU32 {
        enum Void {}
        match self.get_or_try_init(|| Ok::<_, Void>(f())) {
            Ok(val) => val,
            Err(void) => match void {},
        }
    }
    pub fn get_or_try_init<F, E>(&self, f: F) -> Result<core::num::NonZeroU32, E>
    where F: FnOnce() -> Result<core::num::NonZeroU32, E> {
        if let Some(v) = self.get() { return Ok(v); }
        let nz = f()?;
        match self.inner.compare_exchange(0, nz.get(), ${orderings.succ}, ${orderings.fail}) {
            Ok(_) => Ok(nz),
            Err(old) => Ok(unsafe { core::num::NonZeroU32::new_unchecked(old) }),
        }
    }
}
`;
const GOOD = { load: "Ordering::Acquire", succ: "Ordering::Release", fail: "Ordering::Acquire" };
const RELAXED = { load: "Ordering::Relaxed", succ: "Ordering::Relaxed", fail: "Ordering::Relaxed" };
const t1ref = race + T1_IMPL(GOOD);
const t1relaxed = race + T1_IMPL(RELAXED);
const t1delegate = race + `
pub struct OnceNonZeroU32 { inner: OnceNonZeroUsize }
impl OnceNonZeroU32 {
    pub const fn new() -> Self { Self { inner: OnceNonZeroUsize::new() } }
    pub fn get(&self) -> Option<core::num::NonZeroU32> {
        self.inner.get().map(|v| core::num::NonZeroU32::new(v.get() as u32).unwrap())
    }
    pub fn set(&self, value: core::num::NonZeroU32) -> Result<(), ()> {
        self.inner.set(core::num::NonZeroUsize::new(value.get() as usize).unwrap())
    }
    pub fn get_or_init<F>(&self, f: F) -> core::num::NonZeroU32
    where F: FnOnce() -> core::num::NonZeroU32 {
        let v = self.inner.get_or_init(|| core::num::NonZeroUsize::new(f().get() as usize).unwrap());
        core::num::NonZeroU32::new(v.get() as u32).unwrap()
    }
    pub fn get_or_try_init<F, E>(&self, f: F) -> Result<core::num::NonZeroU32, E>
    where F: FnOnce() -> Result<core::num::NonZeroU32, E> {
        let v = self.inner.get_or_try_init(|| f().map(|x| core::num::NonZeroUsize::new(x.get() as usize).unwrap()))?;
        Ok(core::num::NonZeroU32::new(v.get() as u32).unwrap())
    }
}
`;

const T2_REF = `
    pub(crate) fn is_running(&self) -> bool {
        let queue = self.queue.load(Ordering::Acquire);
        strict::addr(queue) & STATE_MASK == RUNNING
    }
`;
const T2_NAIVE = `
    pub(crate) fn is_running(&self) -> bool {
        strict::addr(self.queue.load(Ordering::Acquire)) == RUNNING
    }
`;
const injectT2 = (body) => {
  const marker = "    pub(crate) fn wait(&self) {";
  if (!impStd.includes(marker)) throw new Error("t2 anchor not found");
  return impStd.replace(marker, body + "\n" + marker);
};

const T3_IMPL = (fail, withDrop) => `
        pub fn get_or_init_value(&self, value: Box<T>) -> &T {
            let ptr = Box::into_raw(value);
            match self.inner.compare_exchange(
                ptr::null_mut(),
                ptr,
                Ordering::Release,
                ${fail},
            ) {
                Ok(_) => unsafe { &*ptr },
                Err(old) => {
                    ${withDrop ? "drop(unsafe { Box::from_raw(ptr) });" : "// (loser box intentionally not freed)"}
                    unsafe { &*old }
                }
            }
        }
`;
const injectT3 = (body) => {
  const marker = "        pub fn get_or_init<F>(&self, f: F) -> &T";
  if (!race.includes(marker)) throw new Error("t3 anchor not found");
  return race.replace(marker, body + "\n" + marker);
};

const cases = [
  ["t1-once-u32", t1ref, null],
  ["t1-once-u32", t1relaxed, "contract"],
  ["t1-once-u32", t1delegate, "contract"],
  ["t2-is-running", injectT2(T2_REF), null],
  ["t2-is-running", injectT2(T2_NAIVE), "behavior"],
  ["t3-oncebox-init-value", injectT3(T3_IMPL("Ordering::Acquire", true)), null],
  ["t3-oncebox-init-value", injectT3(T3_IMPL("Ordering::Acquire", false)), "behavior"],
  ["t3-oncebox-init-value", injectT3(T3_IMPL("Ordering::Relaxed", true)), "contract"],
];

let bad = 0;
for (const [id, code, expectGate] of cases) {
  const mod = MODS.find((m) => m.id === id);
  const g = grade(mod, code, `sanity-${id}-${expectGate ?? "ref"}-${Math.random().toString(36).slice(2, 6)}`);
  const pass = g.gate === expectGate;
  console.log(`${id} expect=${expectGate ?? "PASS"}: ${pass ? "SANE" : `BROKEN (got ${g.gate})`} ${g.feedback ? g.feedback.split("\n")[0].slice(0, 100) : ""}`);
  if (!pass) bad++;
}
process.exit(bad ? 1 : 0);
