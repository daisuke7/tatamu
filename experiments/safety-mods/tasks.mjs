// Safety-grade modification tasks on once_cell (docs/40 follow-up).
//
// Each task is designed so that a correct change requires knowledge that
// lives in EXTERNALIZED comments/docs (module ordering guarantees, the
// waiter-pointer state encoding, the CAS-failure Acquire rationale), and so
// that violations are MECHANICALLY detectable:
//   * ordering-scan  — parse atomic-op ordering arguments in the new code
//   * injected tests — grader-owned #[cfg(test)] module appended to the file
//   * drop-counting  — behavior fixture counts Drop calls
//
// Fix rounds are allowed for BUILD errors only. Behavior/contract failures
// are terminal (the graders must not teach the documented answer).

export const MODS = [
  {
    id: "t1-once-u32",
    target: "race",
    task: `Add a new type \`pub struct OnceNonZeroU32\` to \`src/race.rs\`: a thread-safe cell for a \`core::num::NonZeroU32\`, analogous to \`OnceNonZeroUsize\`, with methods \`new\`, \`get\`, \`set\`, \`get_or_init\`, and \`get_or_try_init\` (same signatures/semantics, with u32 types). Implement it DIRECTLY on a \`core::sync::atomic::AtomicU32\` — do NOT wrap or delegate to the existing usize-based types (on 16-bit targets usize is too small for this to be equivalent). It must uphold all guarantees this module makes to its users. Append the new type and its impl at the very END of the file.`,
    // grading: fixture behavior + ordering scan of the region from the first
    // OnceNonZeroU32 occurrence to EOF
    scanRegion: (code) => {
      const i = code.indexOf("OnceNonZeroU32");
      return i === -1 ? null : code.slice(i);
    },
    scanKind: "atomics",
    fixture_main: `use core::num::NonZeroU32;
use once_cell::race::OnceNonZeroU32;
fn main() {
    let c = OnceNonZeroU32::new();
    assert!(c.get().is_none());
    let v = c.get_or_init(|| NonZeroU32::new(7).unwrap());
    assert_eq!(v.get(), 7);
    assert_eq!(c.get().unwrap().get(), 7);
    assert!(c.set(NonZeroU32::new(9).unwrap()).is_err());
    assert_eq!(c.get().unwrap().get(), 7);
    let r: Result<NonZeroU32, ()> = c.get_or_try_init(|| Err(()));
    assert_eq!(r.unwrap().get(), 7);
    let c2 = OnceNonZeroU32::new();
    let r2: Result<NonZeroU32, i32> = c2.get_or_try_init(|| Err(5));
    assert_eq!(r2.unwrap_err(), 5);
    assert!(c2.set(NonZeroU32::new(3).unwrap()).is_ok());
    assert_eq!(c2.get().unwrap().get(), 3);
    println!("OK");
}
`,
  },
  {
    id: "t2-is-running",
    target: "imp_std",
    task: `Add a method \`pub(crate) fn is_running(&self) -> bool\` to \`OnceCell<T>\` in \`src/imp_std.rs\`. It returns \`true\` if and only if an initialization is currently being executed (i.e. some thread is inside \`get_or_try_init\`'s initialization), regardless of how many other threads are queued waiting for it. It must be correct in all states of the cell.`,
    // grading: grader-owned test module appended to the produced file
    inject_tests: `
#[cfg(test)]
mod grader_is_running {
    use super::OnceCell;
    use std::sync::Barrier;

    #[test]
    fn plain_states() {
        let c: OnceCell<u32> = OnceCell::new();
        assert!(!c.is_running(), "empty cell must not be running");
        let _ = c.initialize(|| {
            assert!(c.is_running(), "must be running inside the init closure");
            Ok::<_, ()>(7)
        });
        assert!(!c.is_running(), "completed cell must not be running");
        let d: OnceCell<u32> = OnceCell::with_value(1);
        assert!(!d.is_running());
    }

    #[test]
    fn with_queued_waiters() {
        let c: OnceCell<u32> = OnceCell::new();
        let b = Barrier::new(2);
        std::thread::scope(|s| {
            s.spawn(|| {
                let _ = c.initialize(|| {
                    b.wait(); // release the waiter thread
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    // by now the other thread is queued as a waiter
                    assert!(
                        c.is_running(),
                        "must report running while a waiter is queued"
                    );
                    Ok::<_, ()>(1)
                });
            });
            b.wait();
            let t0 = std::time::Instant::now();
            c.wait();
            assert!(c.is_initialized());
            assert!(t0.elapsed().as_millis() >= 100, "waiter did not actually wait");
        });
    }
}
`,
  },
  {
    id: "t3-oncebox-init-value",
    target: "race",
    task: `Add a method \`pub fn get_or_init_value(&self, value: Box<T>) -> &T\` to \`race::OnceBox<T>\`. If the cell is empty it stores \`value\` and returns a reference to it; if the cell is already initialized (or another thread wins a race), it returns a reference to the existing content. The passed-in \`value\` must never leak and never be dropped twice. Implement it directly with a single \`compare_exchange\` on the inner pointer (do not route through the closure-based \`get_or_init\`/\`get_or_try_init\`).`,
    // grading: drop-count fixture + CAS ordering scan of the fn region
    scanRegion: (code) => {
      const i = code.indexOf("fn get_or_init_value");
      return i === -1 ? null : code.slice(i, i + 2500);
    },
    scanKind: "cas-only",
    fixture_main: `use once_cell::race::OnceBox;
use std::sync::atomic::{AtomicUsize, Ordering};
static DROPS: AtomicUsize = AtomicUsize::new(0);
struct D(u32);
impl Drop for D {
    fn drop(&mut self) {
        DROPS.fetch_add(1, Ordering::SeqCst);
    }
}
fn main() {
    let cell: OnceBox<D> = OnceBox::new();
    let a = cell.get_or_init_value(Box::new(D(1)));
    assert_eq!(a.0, 1);
    assert_eq!(DROPS.load(Ordering::SeqCst), 0, "winner must not be dropped");
    let b = cell.get_or_init_value(Box::new(D(2)));
    assert_eq!(b.0, 1, "existing value must win");
    assert_eq!(DROPS.load(Ordering::SeqCst), 1, "loser must be dropped exactly once");
    drop(cell);
    assert_eq!(DROPS.load(Ordering::SeqCst), 2, "cell drop must free the stored value");
    println!("OK");
}
`,
  },
];

// ---- ordering-contract scanner ----
// Returns null if clean, or a SHORT generic violation tag (never the fix).
export function scanOrderings(region, kind) {
  if (region == null) return "required code region not found (follow the task's placement instructions)";
  const code = region
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  // Ordering tokens INSIDE the call's balanced parens only: wrapper methods
  // that happen to be named like atomic ops (once_cell's own style has a
  // private `fn compare_exchange`) take no Ordering args and must be skipped.
  const argSpan = (openIdx) => {
    let d = 0;
    for (let i = openIdx; i < Math.min(code.length, openIdx + 800); i++) {
      if (code[i] === "(") d++;
      else if (code[i] === ")") {
        d--;
        if (d === 0) return code.slice(openIdx, i + 1);
      }
    }
    return code.slice(openIdx, openIdx + 800);
  };
  const orderingsIn = (m) => [...argSpan(m.index + m[0].length - 1).matchAll(/Ordering::(\w+)/g)].map((x) => x[1]);
  const relOk = (o) => ["Release", "AcqRel", "SeqCst"].includes(o);
  const acqOk = (o) => ["Acquire", "AcqRel", "SeqCst"].includes(o);

  let sawAtomic = false;
  let sawCas = false;
  for (const m of code.matchAll(/compare_exchange(?:_weak)?\s*\(/g)) {
    const os = orderingsIn(m);
    if (os.length < 2) continue; // wrapper call or definition, not a raw CAS
    sawAtomic = true;
    sawCas = true;
    const [succ, fail] = os.slice(-2);
    if (!relOk(succ) || !acqOk(fail)) return "contract violation";
  }
  for (const m of code.matchAll(/\.load\s*\(/g)) {
    const os = orderingsIn(m);
    if (!os.length) continue;
    sawAtomic = true;
    if (!acqOk(os[0])) return "contract violation";
  }
  for (const m of code.matchAll(/\.store\s*\(/g)) {
    const os = orderingsIn(m);
    if (!os.length) continue;
    sawAtomic = true;
    if (!relOk(os[os.length - 1])) return "contract violation";
  }
  for (const m of code.matchAll(/\.swap\s*\(/g)) {
    const os = orderingsIn(m);
    if (!os.length) continue;
    sawAtomic = true;
    if (!(relOk(os[0]) && acqOk(os[0]))) return "contract violation";
  }
  if (kind === "atomics") {
    if (!sawAtomic) return "the new type must operate on its own AtomicU32 directly";
    if (/OnceNonZeroUsize/.test(code)) return "do not delegate to the usize-based types";
  }
  if (kind === "cas-only" && !sawCas) return "implement directly with a compare_exchange as instructed";
  return null;
}
