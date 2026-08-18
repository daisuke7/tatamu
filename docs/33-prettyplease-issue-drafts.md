# prettyplease 上流バグ報告ドラフト(2件)

> 2026-08-18 作成。dtolnay/prettyplease への issue 報告用テキスト。**現時点で報告予定はない** — 報告する場合はここからコピーする。
> 発見経緯: rust2ttm の実クレート測定(docs/31・32)。wasmtime で 1 件目、servo で 2 件目を踏んだ。
> 当方側の回避策は実装済み(1: catch_unwind + トークン印字フォールバック、2: リテラルマスク付き正規表現修復)なので、上流修正が入れば回避コードを削除できる。

---

## Issue 1: Panics on `safe fn` inside `unsafe extern` blocks (edition 2024)

**Title:** `unparse` panics with "not implemented: ForeignItem::Verbatim" on `safe fn` in `unsafe extern` blocks

**Body:**

`prettyplease::unparse` panics when the input contains an `unsafe extern` block with a `safe fn` declaration — stable Rust since 1.82 (`unsafe_extern_blocks`, used widely e.g. in wasmtime's WASI adapter).

```rust
fn main() {
    let src = r#"
        unsafe extern "C" {
            safe fn cosf(f: f32) -> f32;
        }
    "#;
    let file = syn::parse_file(src).unwrap();
    // panics:
    // "not implemented: ForeignItem::Verbatim `safe fn cosf (f : f32) -> f32 ;`"
    let _ = prettyplease::unparse(&file);
}
```

Tested with prettyplease 0.2.37, syn 2.0.119.

syn parses the `safe fn` item as `ForeignItem::Verbatim` (it has no dedicated
AST node), and `prettyplease` hits the `unimplemented!()` arm for
`ForeignItem::Verbatim` in `src/item.rs`.

Expected: the verbatim foreign item is printed as-is (like other
`Verbatim` fallbacks), or `safe fn` gets first-class printing.

Actual: panic, which is surprising for a pretty-printer — any tool that
feeds arbitrary parseable crates through `unparse` (formatters,
code-mods, transpilers) currently needs a `catch_unwind` wrapper just for
this case.

Real-world reproduction: `crates/wasi-preview1-component-adapter/src/lib.rs`
and `cranelift/filetests/src/function_runner.rs` in the wasmtime repository.

---

## Issue 2: Float literal followed by a range prints as invalid Rust (`0. ..=1.` → `0...=1.`)

**Title:** Range expression starting with a float literal is printed without separation: `(0. ..=1.)` becomes `(0...=1.)`, which fails to lex

**Body:**

When a range expression's lower bound is a float literal written with a
trailing dot, `prettyplease::unparse` prints the literal and the range
operator with no separation, producing `...` — which is not valid in
current Rust, so the output no longer parses.

```rust
fn main() {
    let src = r#"
        fn f(u: f64) -> bool {
            (0. ..=1.).contains(&u)
        }
    "#;
    let file = syn::parse_file(src).unwrap();
    let out = prettyplease::unparse(&file);
    println!("{out}");
    // prints:  if !(0...=1.).contains(&u) …  →  `0...=1.`
    // reparsing the output fails:
    // error: unexpected token: `...`
    syn::parse_file(&out).unwrap(); // panics
}
```

Tested with prettyplease 0.2.37, syn 2.0.119.

Expected: a space (or parentheses) preserving lexical validity, e.g.
`(0. ..=1.)` — this is also what rustfmt emits.

Actual: `(0...=1.)` — the round-trip property (parse → unparse → parse)
breaks on this input.

The exclusive form has the same problem (`0. ..1.` → `0...1.`).

Real-world reproduction: `components/shared/webxr/hittest.rs` and
`components/servo_audio/src/panner_node.rs` in the servo repository
(`(0. ..=1.).contains(&u)` in Möller–Trumbore intersection code).
