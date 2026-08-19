// Stage 2 gate retry — large-context axis.
// Material: the rust2ttm codebase itself (5 modules, ~1.6k lines), presented either
// as Tatamu (.ttm + rules) or as the 1:1 generated Rust (.rs).
// Comprehension questions are mechanically graded; every ground truth was verified
// against the real binary before the experiment (see docs/35).

const mc = (expected) => (ans) =>
  typeof ans === "string" && ans.trim().toUpperCase().replace(/[^A-D]/g, "") === expected;

const normLine = (s) =>
  String(s).replace(/^```[a-z]*\n?|```$/g, "").replace(/[`"]/g, "").replace(/\s+/g, " ").trim().replace(/;$/, "");

export const QUESTIONS = [
  {
    id: "tuple-vis",
    q: `When VisClearer (visit_item_mut) processes the tuple struct \`pub struct P(pub i32, i64);\`, what is the visibility state afterwards?
A) Struct visibility and all field visibilities are cleared
B) Struct visibility is cleared; field visibilities are preserved
C) Nothing is cleared
D) Struct visibility is preserved; field visibilities are cleared
Answer with the letter only.`,
    grade: mc("B"),
  },
  {
    id: "use-set",
    q: `A source file contains exactly these use declarations:
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::io::Write;
use crate::util::helper;
Which of them produce a \`#use\` directive in the converted output? Answer with a JSON array of the qualifying paths (e.g. ["std::x::Y"]).`,
    grade: (ans) => {
      if (!Array.isArray(ans)) return false;
      const set = ans.map((s) => String(s).replace(/\s|;|^use\s*/g, "")).sort();
      return JSON.stringify(set) === JSON.stringify(["std::collections::BTreeMap", "std::io::Write"]);
    },
  },
  {
    id: "pp-panic",
    q: `During conversion, what happens if prettyplease::unparse panics while printing an item?
A) The whole conversion aborts with an error
B) The item is silently omitted from the output
C) The item's raw token-stream string is used as the printed form instead
D) An Err is returned for that file
Answer with the letter only.`,
    grade: mc("C"),
  },
  {
    id: "method-owner",
    q: `Given this input:
impl Parser {
    fn step(&mut self) { // advance one token
        self.pos += 1;
    }
}
Under which section name (owner) does the sidecar ledger record the comment "advance one token"? Answer with the exact owner string.`,
    grade: (ans) => normLine(ans) === "Parser::step",
  },
  {
    id: "impl-target",
    q: `What does impl_target return for the line \`impl fmt::Display for Config {\`? Answer with just the returned name.`,
    grade: (ans) => /^(some\(\s*)?config\)?$/i.test(normLine(ans)),
  },
  {
    id: "glue-diff",
    q: `Both join_and_anchor (comments module) and join_wrapped (textual module) join wrapped physical lines using a glue that is either a space or empty. How do their empty-glue conditions differ?
A) They are identical
B) join_and_anchor uses a space when the next line starts with \`..\`; join_wrapped does not make that exception
C) join_wrapped also uses empty glue when the previous line ends with \`{\`
D) join_wrapped uses a space (not empty glue) when the next line starts with \`..\`; join_and_anchor empty-glues any leading \`.\`
Answer with the letter only.`,
    grade: mc("D"),
  },
  {
    id: "trailing-commas",
    q: `strip_trailing_commas removes a comma (plus following spaces) only when it is directly followed by which closing delimiter(s)?
A) ) ] and }
B) only )
C) ) and ]
D) only }
Answer with the letter only.`,
    grade: mc("C"),
  },
  {
    id: "pub-crate",
    q: `In the compare normalization, how is \`pub(crate)\` visibility treated?
A) Compared verbatim, so pub(crate) vs pub is a mismatch
B) It causes a comparison error
C) Treated the same as pub
D) Binarized to non-pub (same as private)
Answer with the letter only.`,
    grade: mc("D"),
  },
  {
    id: "macrorules-delim",
    q: `In the compare normalization (visit_macro_mut), what happens to a \`macro_rules!\` definition whose outer delimiter is parentheses?
A) The delimiter is normalized to braces, and non-brace rule bodies are also braced
B) It is left unchanged
C) The macro is dropped from comparison
D) It is an error
Answer with the letter only.`,
    grade: mc("A"),
  },
  {
    id: "line-letmut",
    q: `What exact single line does the statement \`let mut total: i64 = 0;\` (inside a fn body) become in the converted output? Answer with the exact line.`,
    grade: (ans) => normLine(ans) === "mut total: i64 := 0",
  },
  {
    id: "line-const",
    q: `What exact single line does the top-level item \`pub const LIMIT: usize = 8;\` become in the converted output? Answer with the exact line.`,
    grade: (ans) => normLine(ans) === "const LIMIT usize = 8",
  },
  {
    id: "doc-comments",
    q: `How does extract_ledger treat source lines starting with /// or //! ?
A) Recorded as "above" entries
B) Recorded as "tail" entries
C) Skipped — they never become ledger entries
D) They abort extraction
Answer with the letter only.`,
    grade: mc("C"),
  },
];

// ---- modification tasks ----
// Each: target module (same stem in both conditions), task text, fixture files,
// and a check(runBin, workDir) -> {ok, detail} that exercises the rebuilt binary.

export const FIXTURE_M1 = {
  "a.rs": "pub fn one() -> i64 { 1 }\n",
  "b.rs": "pub fn two() -> i64 { 2 }\n",
};

export const FIXTURE_M2 = {
  "m2.rs": `pub fn work() -> i64 {
    // TODO refactor this
    let a = 1;
    let b = a + 1; // TODO tail case
    // plain note
    a + b
}
`,
};

export const FIXTURE_M3 = {
  "m3.rs": `pub fn note() -> i64 {
    let x = 1; /* hmm */
    /* solo */
    let y = 2;
    x + y
}
`,
};

export const MODS = [
  {
    id: "count-cmd",
    target: "main",
    task: `Add a third subcommand \`count <src-dir>\` to the CLI. It must print to stdout exactly one line \`files: N\` where N is the number of files with the .rs extension directly in <src-dir>, then exit successfully. The existing convert/compare subcommands and the usage error must keep working.`,
    fixtures: FIXTURE_M1,
    check: (run, work) => {
      const r1 = run(["count", `${work}/fixture`]);
      if (r1.status !== 0) return { ok: false, detail: `count exited ${r1.status}: ${r1.stderr.slice(0, 400)}` };
      if (!/^files: 2$/m.test(r1.stdout)) return { ok: false, detail: `expected "files: 2" on stdout, got: ${r1.stdout.slice(0, 200)}` };
      const r2 = run(["convert", `${work}/fixture`, `${work}/fixture-out`]);
      if (r2.status !== 0) return { ok: false, detail: `convert broke: ${r2.stderr.slice(0, 400)}` };
      return { ok: true };
    },
  },
  {
    id: "todo-kind",
    target: "comments",
    task: `Change the comment ledger so that any extracted comment whose text starts with "TODO" is recorded with kind \`todo\` instead of \`above\` or \`tail\` (the text itself stays unchanged, including the TODO prefix). Comments not starting with "TODO" must keep their current kind.`,
    fixtures: FIXTURE_M2,
    check: (run, work) => {
      const r = run(["convert", `${work}/fixture`, `${work}/fixture-out`]);
      if (r.status !== 0) return { ok: false, detail: `convert failed: ${r.stderr.slice(0, 400)}` };
      let doc = "";
      try { doc = r.read(`${work}/fixture-out/m2.doc.md`); } catch { return { ok: false, detail: "no m2.doc.md produced" }; }
      if (!/~ todo .*TODO refactor this/.test(doc)) return { ok: false, detail: `missing "~ todo ... TODO refactor this" in:\n${doc}` };
      if (!/~ todo .*TODO tail case/.test(doc)) return { ok: false, detail: `missing "~ todo ... TODO tail case" in:\n${doc}` };
      if (!/~ above .*plain note/.test(doc)) return { ok: false, detail: `non-TODO comment lost its "above" kind in:\n${doc}` };
      if (/~ (above|tail) .*TODO/.test(doc)) return { ok: false, detail: `a TODO comment still has above/tail kind in:\n${doc}` };
      return { ok: true };
    },
  },
  {
    id: "block-tail",
    target: "comments",
    task: `Currently a single-line block comment /* ... */ is always recorded as an \`above\` comment, even when it appears after code on the same line (trailing position). Change extraction so that a single-line block comment that has code before it on the same line is recorded as a \`tail\` comment of that line instead. Block comments on their own line (no code before them) must still become \`above\` comments.`,
    fixtures: FIXTURE_M3,
    check: (run, work) => {
      const r = run(["convert", `${work}/fixture`, `${work}/fixture-out`]);
      if (r.status !== 0) return { ok: false, detail: `convert failed: ${r.stderr.slice(0, 400)}` };
      let doc = "";
      try { doc = r.read(`${work}/fixture-out/m3.doc.md`); } catch { return { ok: false, detail: "no m3.doc.md produced" }; }
      if (!/~ tail .*: hmm/.test(doc)) return { ok: false, detail: `trailing block comment not recorded as tail in:\n${doc}` };
      if (/~ above .*: hmm/.test(doc)) return { ok: false, detail: `trailing block comment still recorded as above in:\n${doc}` };
      if (!/~ above .*: solo/.test(doc)) return { ok: false, detail: `own-line block comment lost its above kind in:\n${doc}` };
      return { ok: true };
    },
  },
];
