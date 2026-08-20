// Fresh-context lens experiment — question and modification task definitions.
//
// D* questions: the answer lives ONLY in externalized comments/docs (module
//   intro, item docs, inline comments). In the stripped condition the model
//   must either fetch notes or guess.
// C* questions: the answer is derivable from the code alone. Fetching notes
//   is unnecessary — measures discrimination.
//
// All questions are single-letter multiple choice, graded mechanically.

export const QUESTIONS = [
  {
    id: "d1-orderings",
    kind: "doc",
    q: `According to the documentation of the \`race\` module, which atomic orderings do the types in this module use for all their operations?
A) Relaxed only
B) Acquire and Release
C) SeqCst
D) Acquire for loads, Relaxed for stores`,
    answer: "B",
  },
  {
    id: "d2-race-behavior",
    kind: "doc",
    q: `Per the \`race\` module documentation: when two threads race to initialize a type from this module, what happens?
A) The second thread blocks until the first finishes
B) Both threads execute the initialization function, but only one of them stores the result
C) The second thread immediately gets an error
D) The behavior is unspecified`,
    answer: "B",
  },
  {
    id: "d3-acquire-failure",
    kind: "doc",
    q: `In \`race.rs\` there is an explanatory comment about the choice of atomic orderings for \`compare_exchange\`. According to it, why must \`Acquire\` be used on the failure path?
A) Failure means another thread currently holds a lock that must be released first
B) The nonzero value observed on failure was previously stored with \`Release\`, so \`Acquire\` is needed to establish happens-before with that store
C) \`compare_exchange\` requires \`Acquire\` on failure by API contract
D) To prevent the compiler from reordering the initialization closure`,
    answer: "B",
  },
  {
    id: "d4-imp-std-origin",
    kind: "doc",
    q: `The implementation in \`imp_std.rs\` is described (in a comment) as copied from a standard-library type with two changes. Which two?
A) No poisoning, and the init function can fail
B) Lock-free operation, and no heap allocation
C) Timeout support, and spurious wakeup handling
D) No spinning, and FIFO waiter fairness`,
    answer: "A",
  },
  {
    id: "d5-waiter-states",
    kind: "doc",
    q: `In \`imp_std.rs\`, the \`queue\` field encodes the cell state in the two low bits of a pointer. According to the comment describing it, which states allow waiters?
A) RUNNING only
B) INCOMPLETE and RUNNING
C) COMPLETE and RUNNING
D) All three states`,
    answer: "B",
  },
  {
    id: "d6-send-bound",
    kind: "doc",
    q: `\`imp_std.rs\` has a comment answering "Why do we need \`T: Send\`?" for the \`Sync\` impl of \`OnceCell<T>\`. What scenario does it give?
A) The cell itself may be sent by value between threads
B) Thread A creates the cell, a scoped thread B fills it, and A then destroys it — so the destructor observes a value sent from another thread
C) The initialization closure may be executed on a different thread than the caller
D) \`get_or_init\` may hand out references across threads`,
    answer: "B",
  },
  {
    id: "d7-const-lazy",
    kind: "doc",
    q: `According to the crate-level documentation, what happens if you declare a global \`sync::Lazy\` with \`const\` instead of \`static\`?
A) It fails to compile
B) It compiles but works wrong
C) It works identically
D) It requires unsafe code`,
    answer: "B",
  },
  {
    id: "d8-msrv-policy",
    kind: "doc",
    q: `Per the crate-level documentation, when only the \`std\`, \`alloc\`, or \`race\` features are enabled, what is the MSRV policy?
A) MSRV is fixed at 1.56 forever
B) MSRV always tracks the latest stable release
C) MSRV is updated conservatively, supporting at least the latest 8 compiler versions
D) MSRV is updated on every minor release`,
    answer: "C",
  },
  {
    id: "c1-state-values",
    kind: "code",
    q: `In \`imp_std.rs\`, what are the numeric values of the \`INCOMPLETE\`, \`RUNNING\` and \`COMPLETE\` state constants, in that order?
A) 0x0, 0x1, 0x2
B) 0x1, 0x2, 0x3
C) 0x0, 0x2, 0x3
D) 0x1, 0x2, 0x4`,
    answer: "A",
  },
  {
    id: "c2-oncebool-repr",
    kind: "code",
    q: `How is \`race::OnceBool\` represented internally?
A) An \`AtomicBool\`
B) A \`OnceNonZeroUsize\`
C) A raw \`AtomicUsize\`
D) A \`Cell<Option<bool>>\``,
    answer: "B",
  },
  {
    id: "c3-isinit-ordering",
    kind: "code",
    q: `In \`imp_std.rs\`, \`OnceCell::is_initialized\` loads \`self.queue\` with which atomic ordering?
A) Relaxed
B) Acquire
C) SeqCst
D) Release`,
    answer: "B",
  },
  {
    id: "c4-oncebox-set-err",
    kind: "code",
    q: `What does \`race::OnceBox::set\` return when the cell was already full?
A) \`Err(())\`
B) \`Err(Box<T>)\` — the rejected value is handed back
C) It panics
D) \`Ok(())\` — the new value is silently dropped`,
    answer: "B",
  },
];

// ---- modification tasks (target file: src/race.rs) ----

export const MODS = [
  {
    id: "m1-is-initialized",
    target: "race",
    task: `Add a method \`pub fn is_initialized(&self) -> bool\` to each of the four public cell types in the \`race\` module (\`OnceNonZeroUsize\`, \`OnceBool\`, \`OnceRef\`, and \`OnceBox\`). It returns whether the cell has been set, without initializing it. Follow the module's existing conventions.`,
    fixture_main: `use core::num::NonZeroUsize;
use once_cell::race::{OnceBool, OnceBox, OnceNonZeroUsize, OnceRef};
fn main() {
    let a = OnceNonZeroUsize::new();
    assert!(!a.is_initialized());
    a.set(NonZeroUsize::new(7).unwrap()).unwrap();
    assert!(a.is_initialized());
    let b = OnceBool::new();
    assert!(!b.is_initialized());
    b.set(true).unwrap();
    assert!(b.is_initialized());
    let val = 42u32;
    let r: OnceRef<u32> = OnceRef::new();
    assert!(!r.is_initialized());
    r.set(&val).unwrap();
    assert!(r.is_initialized());
    let bx: OnceBox<i32> = OnceBox::new();
    assert!(!bx.is_initialized());
    bx.set(Box::new(5)).unwrap();
    assert!(bx.is_initialized());
    println!("OK");
}
`,
  },
  {
    id: "m2-oncebox-into-inner",
    target: "race",
    task: `Add a method \`pub fn into_inner(self) -> Option<Box<T>>\` to \`race::OnceBox<T>\`. It consumes the cell and returns the stored box if the cell was initialized, or \`None\` otherwise. Make sure the value is neither leaked nor dropped twice (note that \`OnceBox\` has a \`Drop\` impl).`,
    fixture_main: `use once_cell::race::OnceBox;
fn main() {
    let b: OnceBox<String> = OnceBox::new();
    assert!(b.into_inner().is_none());
    let b: OnceBox<String> = OnceBox::new();
    b.set(Box::new("hello".to_string())).unwrap();
    let v = b.into_inner();
    assert_eq!(v.as_deref().map(|s| s.as_str()), Some("hello"));
    drop(v);
    println!("OK");
}
`,
  },
];
