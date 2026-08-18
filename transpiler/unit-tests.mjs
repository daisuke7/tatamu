// tatamuc unit-test corpus: diagnostics (--check / --doc-check) and transform
// assertions. Fast (no rustc) — every historical bug gets a minimal case here.
//
// run: node transpiler/unit-tests.mjs

import { transpile, diagnose, docCheck, buildProject } from "./tatamuc.mjs";

// ---------- diagnostics cases ----------
// expect: [rule, line] pairs that MUST be present; forbid: rules that MUST NOT fire.

const DIAG_CASES = [
  // --- positives: each rule fires where it should ---
  { name: "let binding", src: `fn main() {\nlet x = 5;\n}`, expect: [["no-let-binding", 2]] },
  { name: "let mut binding", src: `fn main() {\nlet mut n = 0;\n}`, expect: [["no-let-binding", 2]] },
  { name: "mut without walrus (opus bug)", src: `fn main() {\nmut stack = Vec::new()\n}`, expect: [["mut-binding-needs-walrus", 2]] },
  { name: "use line", src: `use std::fs;\nfn main() {}`, expect: [["no-use-lines", 1]] },
  { name: "arrow in signature", src: `fn area(r f64) -> f64 {r * r}`, expect: [["no-arrow", 1]] },
  { name: "derive attribute", src: `#[derive(Debug, Clone)]\nstruct P {x f64}`, expect: [["derive-shorthand", 1]] },
  { name: "pub keyword", src: `pub fn get() u8 {1}`, expect: [["no-pub", 1]] },
  { name: "indentation", src: `fn main() {\n    x := 1\n}`, expect: [["no-indentation", 2]] },
  { name: "trailing semicolon is info only", src: `fn main() {\nx := 1;\n}`, expect: [["trailing-semicolon", 2]], ok: true },
  { name: "unbalanced braces", src: `fn main() {\nx := 1\n`, expect: [["unbalanced-delimiters", 3]] },

  // --- negatives: rules must NOT fire (false-positive guards) ---
  { name: "let inside string (mdlite bug)", src: `fn main() {\nassert_eq!(f("x"), "let x = 1;")\n}`, forbid: ["no-let-binding"], ok: true },
  { name: "use inside string", src: `fn main() {\ns := "use std::fs;"\n}`, forbid: ["no-use-lines"], ok: true },
  { name: "arrow inside string", src: `fn main() {\ns := "a -> b"\n}`, forbid: ["no-arrow"], ok: true },
  { name: "pub inside string", src: `fn main() {\ns := "pub fn x"\n}`, forbid: ["no-pub"], ok: true },
  { name: "if let is allowed", src: `fn main() {\nif let Some(v) = opt {use_it(v)}\n}`, forbid: ["no-let-binding"], ok: true },
  { name: "while let is allowed", src: `fn main() {\nwhile let Some(v) = it.next() {go(v)}\n}`, forbid: ["no-let-binding"], ok: true },
  { name: "else if let is allowed", src: `fn main() {\nif a {b()} else if let Some(v) = c {d(v)}\n}`, forbid: ["no-let-binding"], ok: true },
  { name: "ident containing let", src: `fn main() {\ncompleted := 1\noutlet := 2\n}`, forbid: ["no-let-binding"], ok: true },
  { name: "#use directive is not a use line", src: `#use std::fmt::Write\nfn main() {}`, forbid: ["no-use-lines"], ok: true },
  { name: "char literal quotes do not break squashing", src: `fn main() {\nc := 'a'\nd := '"'\ns := "let x = 1;"\n}`, forbid: ["no-let-binding"], ok: true },
  { name: "clean tatamu is clean", src: `struct P +Debug {x f64}\nfn area(p &P) f64 {p.x * p.x}\nfn main() {\np := P {x: 2.0}\nprintln!("{}", area(&p))\n}`, expect: [], ok: true },
  // --- adversarial round 2 (found by probing) ---
  { name: "line comment flagged", src: `fn main() {\nx := 1 // temp\n}`, expect: [["no-comments", 2]], ok: true },
  { name: "block comment flagged", src: `fn main() {\n/* note */ x := 1\n}`, expect: [["no-comments", 2]], ok: true },
  { name: "url in string is not a comment", src: `fn main() {\nu := "https://x.dev"\n}`, forbid: ["no-comments"], ok: true },
  { name: "raw string contents squashed", src: `fn main() {\ns := r#"let x = 1; // and "quotes" too"#\n}`, forbid: ["no-let-binding", "no-comments"], ok: true },
];

// ---------- doc freshness cases ----------

const DOC_CASES = [
  {
    name: "orphan section",
    ttm: `fn run() {}`,
    sidecar: `## gone\n\nOld docs.`,
    expect: ["doc-orphan", "doc-missing"],
  },
  {
    name: "stale signature",
    ttm: `fn parse(s &str, strict bool) R<u8> {Ok(1)}`,
    sidecar: "## parse\n\n`fn parse(s &str) R<u8>`\n\nParses.",
    expect: ["doc-stale-signature"],
  },
  {
    name: "missing doc is info",
    ttm: `fn undocumented() {}`,
    sidecar: ``,
    expect: ["doc-missing"],
    ok: true,
  },
  {
    name: "matching signature is quiet",
    ttm: `fn parse(s &str) R<u8> {Ok(1)}`,
    sidecar: "## parse\n\n`fn parse(s &str) R<u8>`\n\nParses.",
    expect: [],
    ok: true,
  },
  {
    name: "struct field change is stale",
    ttm: `struct Config +Debug {host String, port u16, tls bool}`,
    sidecar: "## Config\n\n`struct Config +Debug {host String, port u16}`\n\nConfig.",
    expect: ["doc-stale-signature"],
  },
  // --- comment ledger ---
  {
    name: "ledgered comment with live anchor is quiet",
    ttm: "fn f() u8 {\nx := compute()\nx + 1\n}",
    sidecar: "## f\n\n`fn f() u8`\n\nDocs.\n\n~ tail `x := compute()`: cached upstream",
    expect: [],
    ok: true,
  },
  {
    name: "broken anchor is comment-orphan warning",
    ttm: "fn f() u8 {\ny := compute()\ny + 1\n}",
    sidecar: "## f\n\n~ tail `x := compute()`: cached upstream",
    expect: ["comment-orphan"],
    ok: true,
  },
  {
    name: "SAFETY orphan is an error",
    ttm: "fn f() u8 {\ny := 1\ny\n}",
    sidecar: "## f\n\n~ above `x := deref(p)`: SAFETY: p is non-null by contract",
    expect: ["comment-orphan"],
    ok: false,
  },
  {
    name: "ordinal anchor requires nth occurrence",
    ttm: "fn f() {\ni += 1\n}",
    sidecar: "## f\n\n~ tail `i += 1`#3: only fires on the third",
    expect: ["comment-orphan"],
    ok: true,
  },
];

// ---------- transform cases (contains / excludes on transpile output) ----------

const TRANSFORM_CASES = [
  // bindings
  { name: "walrus", src: `fn main() {\nx := 5\n}`, contains: ["let x = 5;"] },
  { name: "mut walrus", src: `fn main() {\nmut x := 5\n}`, contains: ["let mut x = 5;"] },
  { name: "tuple walrus", src: `fn main() {\n(a, b) := f()\n}`, contains: ["let (a, b) = f();"] },
  { name: "annotated walrus", src: `fn main() {\nxs: Vec<_> := it.collect()\n}`, contains: ["let xs: Vec<_> = it.collect();"] },
  { name: "annotated walrus with path type", src: `fn main() {\nkept: Vec<syn::Item> := xs.collect()\nmut m: std::collections::HashMap<String, u8> := HashMap::new()\n}`, contains: ["let kept: Vec<syn::Item> = xs.collect();", "let mut m: std::collections::HashMap<String, u8> = HashMap::new();"] },
  { name: "reassignment untouched", src: `fn main() {\nmut x := 1\nx = 2\n}`, contains: ["x = 2;"], excludes: ["let x = 2"] },
  // signatures
  { name: "fn signature", src: `fn add(a i64, b i64) i64 {a + b}`, contains: ["fn add(a: i64, b: i64) -> i64 {a + b}"] },
  { name: "generics preserved", src: `fn largest<T: PartialOrd + Copy>(list &[T]) T {list[0]}`, contains: ["fn largest<T: PartialOrd + Copy>(list: &[T]) -> T"] },
  { name: "lifetimes", src: `fn longest<'a>(x &'a str, y &'a str) &'a str {x}`, contains: ["fn longest<'a>(x: &'a str, y: &'a str) -> &'a str"] },
  { name: "mut param", src: `fn gcd(mut a u64, mut b u64) u64 {a}`, contains: ["fn gcd(mut a: u64, mut b: u64) -> u64"] },
  { name: "split derive attributes are all kept", src: `#[derive(Serialize, Debug)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
enum Scope +Serialize,Debug,Default { #[default] Expr, Item, }`, contains: ["derive"] },
  { name: "rust-shaped const in macro body stays intact", src: `macro_rules! m {
() => {
const _: () = { f(); };
};
}`, contains: ["const _: () = { f(); };"], excludes: ["_: :"] },
  { name: "valueless const declaration in trait", src: `trait Sealed {
const VALUE Self;
}`, contains: ["const VALUE: Self;"] },
  { name: "lowercase const in trait", src: `trait T: Sized {
const peek_any private::PeekFn = private::PeekFn
fn unraw(&self) Ident;
}`, contains: ["const peek_any: private::PeekFn = private::PeekFn;"] },
  { name: "macro type in ascribed binding", src: `fn f(input I) R<X> {
colon_token: Token![:] := input.parse()?
Ok(colon_token)
}`, contains: ["let colon_token: Token![:] = input.parse()?;"] },
  { name: "return of multi-line match", src: `fn f(e E) Option<X> {
return match e {
E::A(n) => {
n.find(not_trivia)
}
_ => None,
}
fn not_trivia() {}
}`, contains: ["n.find(not_trivia)", "};"], excludes: ["find(not_trivia);"] },
  { name: "const with closure initializer", src: `const _ fn() = || {
fn is_sync<T: Sync>() {}
is_sync::<Summary>();
}
fn next_fn() {}`, contains: ["const _: fn() = || {", "};", "fn next_fn() {}"] },
  { name: "const with block initializer", src: `const _ () = {
const fn is_copy<T: Copy>() {}
is_copy::<X>();
}`, contains: ["const _: () = {", "};"], excludes: ["= {;"] },
  { name: "brace pattern with typed fields let-else", src: `fn f(v V) Option<u8> {
ProbeKind::TraitCandidate { source: victim_source, result: _ } := v.kind() else { return None }
Some(1)
}`, contains: ["let ProbeKind::TraitCandidate { source: victim_source, result: _ } = v.kind() else { return None };"] },
  { name: "brace pattern let-else binding", src: `fn f(lit L) Result<u8, ()> {
TokenKind::Literal { kind, suffix_start } := lit.kind else { return Err(()) }
Ok(kind)
}`, contains: ["let TokenKind::Literal { kind, suffix_start } = lit.kind else { return Err(()) };"] },
  { name: "at-bound pattern parameter", src: `fn f(ctx @ PathCtx { qualified, .. }: &PathCtx) u8 { 0 }`, contains: ["ctx @ PathCtx { qualified, .. }: &PathCtx) -> u8"] },
  { name: "multi-field destructuring parameter", src: `fn f(db &DB, FilePosition { file_id, offset }: FilePosition) u8 { 0 }`, contains: ["FilePosition { file_id, offset }: FilePosition) -> u8"] },
  { name: "struct destructuring parameter", src: `fn from(Input { input }: Input<'a>) Self { input }`, contains: ["fn from(Input { input }: Input<'a>) -> Self"] },
  { name: "return of struct literal gets semi", src: `fn f(num u32, semaphore S) Self {
#[cfg(feature = "tracing")]
return Self { node: W::new(num), semaphore, queued: false, }
#[cfg(not(feature = "tracing"))]
return Self { node: W::new(num), semaphore, queued: true, }
}`, contains: ["queued: false, };", "queued: true, };"] },
  { name: "let statement before fn closer keeps semi", src: `fn f(&self) u8 {
g := || {
_ := self.x.update(|c| c + 1)
}
g();
1
}`, contains: ["let _ = self.x.update(|c| c + 1);"] },
  { name: "raw pointer type ascription binding", src: `fn f(&mut self) {
self_ptr: *mut F := self.boxed.as_ptr() as *mut F
use_ptr(self_ptr)
}`, contains: ["let self_ptr: *mut F = self.boxed.as_ptr() as *mut F;"], excludes: ["*let"] },
  { name: "multi-line where struct header is not a unit struct", src: `struct MapDeserializer<'de, I, E> where I: Iterator,
I::Item: Pair,
{
iter iter::Fuse<I>,
}`, contains: ["struct MapDeserializer<'de, I, E> where I: Iterator,", "I::Item: Pair,"], excludes: ["Iterator,;"] },
  { name: "unit struct with where clause and derives", src: `struct Reaper<W, Q, S>(W) +Debug where W: Wait;`, contains: ["#[derive(Debug)]", "struct Reaper<W, Q, S>(W) where W: Wait;"] },
  { name: "string ending in r before another string", src: `fn t() {
args := parse_low_raw(["-r", "foo"]).unwrap()
check(args)
}`, contains: ["[\"-r\", \"foo\"]).unwrap();", "check(args);"] },
  { name: "escaped backslash-r is not a raw string", src: `fn t() Vec<(&str, u8)> {
vec![("\\\\r", 13u8), ("\\\\v", 11u8)]
}`, contains: ["(\"\\\\r\", 13u8), (\"\\\\v\", 11u8)"] },
  { name: "cfg attribute with string on a parameter", src: `fn new_header(state State, #[cfg(all(unstable, feature = "tracing"))] tid Option<Id>) Header {
h(state, tid)
}`, contains: ["#[cfg(all(unstable, feature = \"tracing\"))] tid: Option<Id>) -> Header {"] },
  { name: "macro_rules body keeps token semicolons", src: `macro_rules! cr {
() => {
mod lib { pub use x::Y; pub use z::W; }
};
}`, contains: ["pub use x::Y; pub use z::W; }"] },
  { name: "pub use with brace list gets semi", src: `mod lib {
pub use self::core::result
#[cfg(feature = "std")] pub use std::borrow:: { Cow, ToOwned }
pub use x::Y
}`, contains: ["pub use self::core::result;", "{ Cow, ToOwned };", "pub use x::Y;"] },
  { name: "attribute-prefixed statement gets semi", src: `fn f(&self, debug &mut D) R<()> {
#[cfg(any(feature = "std", feature = "alloc"))] debug.field(&self.err)
debug.finish()
}`, contains: ["debug.field(&self.err);", "debug.finish()"] },
  { name: "range pattern arm block is not an assignment", src: `fn f(byte u8, total &mut Vec<bool>) {
match byte {
b'.' | b'0'..=b'9' => {
total[usize::from(byte)] = true
}
_ => {}
}
}`, contains: ["total[usize::from(byte)] = true;"], excludes: ["};\n        _"] },
  { name: "string ending in r is not a raw-string opener", src: `fn f() {
wfile(td.path().join("bar"), "")
mut builder := W::new(td.path())
assert_paths(td.path(), &builder, &["bar", "a", "a/bar"])
}`, contains: ["wfile(td.path().join(\"bar\"), \"\");", "let mut builder = W::new(td.path());", "&[\"bar\", \"a\", \"a/bar\"]);"] },
  { name: "const fn with attr params is not an initializer", src: `const fn to_u64(#[cfg(feature = "bigidx")] val u64) u64 {
val
}
fn after() {}`, contains: ["const fn to_u64(#[cfg(feature = \"bigidx\")] val: u64) -> u64 {", "fn after() {}"], excludes: ["};"] },
  { name: "closure-bound generics with arrow", src: `unsafe fn take<'a, F: Fn(&'a [u8]) ->(IdxSize, &'a [u8]) , >(f F) Option<IdxSize> { g(f) }`, contains: ["(f: F) -> Option<IdxSize>"], excludes: ["-> , >"] },
  { name: "static before fn closer keeps semi", src: `fn total_memory() u64 {
static TOTAL: LazyLock<u64> = LazyLock::new(|| { compute() })
*TOTAL
}`, contains: ["LazyLock::new(|| { compute() });"] },
  { name: "turbofish tuple pattern binding", src: `fn f(p Pair) R<()> {
ArrayPair::<T, N>(l, r) := p.split()
use_lr(l, r)
}`, contains: ["let ArrayPair::<T, N>(l, r) = p.split();"] },
  { name: "inline extern block with fn declaration", src: `extern "C" fn run() u32 { unsafe extern "C" { safe fn _start () ; } _start () ; 0 }`, contains: ["safe fn _start(); }", "_start () ; 0 }"], excludes: ["-> ;"] },
  { name: "enum body folded to one line keeps following items", src: `priv enum ES {
Running(Pin<Box<dyn F>>), Done { inner: Box<dyn D>, }, }
impl E {
priv fn make(mut inner Box<dyn D>) Self { Self }
}`, contains: ["fn make(mut inner: Box<dyn D>) -> Self"] },
  { name: "multi-line struct variant with field attribute", src: `enum TraceInfo +Debug {
Array {
#[cfg_attr(not(feature = "gc-drc"), allow(dead_code))]
gc_ref_elems bool,
},
}`, contains: ["gc_ref_elems: bool,"] },
  { name: "struct-pattern arm folded to one line", src: `fn cb(state &mut State) u32 {
match state {
&mut State::S0 { stream, future, } => { g(stream); *state = State::S1 { stream, future, }; YIELD }
_ => DONE,
}
}`, contains: ["YIELD }"], excludes: ["YIELD };"] },
  { name: "item-position macro with arrow tokens gets semi", src: `impl Foo {
tuple_impl_body!(1 => (0 T))
}`, contains: ["tuple_impl_body!(1 => (0 T));"] },
  { name: "path-pattern let-else binding", src: `fn f(t &T) Option<u8> {
Token::Literal(c) := *t else { return None }
Some(c)
}`, contains: ["let Token::Literal(c) = *t else { return None };"], excludes: ["Literallet"] },
  { name: "nested tuple pattern binding", src: `fn g(r R) u8 {
Ok((a, b)) := r else { return 0 }
a + b
}`, contains: ["let Ok((a, b)) = r else { return 0 };"] },
  { name: "inline assignment of if expression gets semi", src: `fn f(args &mut A, p P) R<()> {
args.h = if p.is_empty() { None } else { Some(p) }
Ok(())
}`, contains: ["Some(p) };"] },
  { name: "multi-line use block in fn body", src: `fn f() u8 {
use self::T::{
A, B,
}
g(A)
}`, contains: ["A, B,", "};", "g(A)"], excludes: ["}\n    g"] },
  { name: "fn with where clause (no return type)", src: `fn interp<A>(mut ap A, dst &mut Vec<u8>) where A: FnMut(usize, &mut Vec<u8>),
{
ap(1, dst)
}`, contains: ["fn interp<A>(mut ap: A, dst: &mut Vec<u8>) where A: FnMut(usize, &mut Vec<u8>),", "ap(1, dst);"], excludes: ["-> where"] },
  { name: "fn with return type and where clause across lines", src: `fn pick<T>(v Vec<T>) T where T: Clone,
{
v[0].clone()
}`, contains: ["fn pick<T>(v: Vec<T>) -> T where T: Clone,", "v[0].clone()"], excludes: ["clone();"] },
  { name: "assignment of multi-line if gets closer semi", src: `fn f(v V, args &mut A) R<()> {
args.binary = if v.unwrap_switch() {
B::SearchAndSuppress
} else {
B::Auto
}
Ok(())
}`, contains: ["};"], excludes: ["SearchAndSuppress;", "Auto;"] },
  { name: "compound assignment of match block", src: `fn g(x &mut i64, c C) {
*x += match c {
C::A => 1,
_ => 2,
}
done()
}`, contains: ["};", "done();"], excludes: ["=> 1;"] },
  { name: "single-line macro keeps its fn tokens intact", src: `fn g() TokenStream {
Ok(quote! { impl X for Y { fn command <'b > () -> clap::Command { body() } fn other() -> u8 { 1 } } })
}`, contains: ["fn command <'b > () -> clap::Command { body() }", "fn other() -> u8 { 1 }"], excludes: ["-> ->", "commandfn"] },
  { name: "closed macro then if-block is not verbatim", src: `fn f(mat M, args A) R<()> {
value := if matches!(mat.kind, K::Negated) {
V::Switch(false)
} else {
V::Switch(true)
}
mat.flag.update(value, args)?
Ok(())
}`, contains: ["let value = if matches!(mat.kind, K::Negated) {", "V::Switch(false)", "};", "mat.flag.update(value, args)?;"] },
  { name: "macro invocation body is verbatim", src: `fn f() proc_macro2::TokenStream {
quote! {
impl Foo for Bar { fn baz() -> u32 { 1 } }
let x = 1;
}
}`, contains: ["fn baz() -> u32", "let x = 1;"], excludes: ["let x = 1;;", "baz() u32", "x := 1"] },
  { name: "let-bound multi-line macro keeps its closer semi", src: `fn g() u32 {
t := quote! {
fn q() -> u32;
};
1
}`, contains: ["let t = quote! {", "fn q() -> u32;", "};"] },
  { name: "impl Trait nested tuple params", src: `fn f(mut self, ifs impl IntoIterator<Item = (impl Into<Id>, impl Into<Pred>)>) Self {self}`, contains: ["ifs: impl IntoIterator<Item = (impl Into<Id>, impl Into<Pred>)>"], excludes: ["impl:"] },
  { name: "fn pointer param type", src: `fn g(cb fn(u8) -> u8, x u8) u8 {cb(x)}`, contains: ["cb: fn(u8) -> u8, x: u8"] },
  { name: "extern C fn", src: `#[no_mangle]\nextern "C" fn add(a i64, b i64) i64 {a + b}`, contains: [`extern "C" fn add(a: i64, b: i64) -> i64`] },
  { name: "trait method decl gets semicolon", src: `trait Area {\nfn area(&self) f64\n}`, contains: ["fn area(&self) -> f64;"] },
  { name: "extern block decl", src: `extern "C" {\nfn c_mul(a i64, b i64) i64\n}`, contains: ["fn c_mul(a: i64, b: i64) -> i64;"] },
  // structs / enums / const
  { name: "struct shorthand", src: `struct P +Debug,Clone {x f64, y f64}`, contains: ["#[derive(Debug, Clone)]", "x: f64,", "y: f64,"] },
  { name: "unit struct derive", src: `struct Marker +Debug`, contains: ["#[derive(Debug)]", "struct Marker;"] },
  { name: "tuple struct derive", src: `struct Wrap(u8, String) +Debug,Clone`, contains: ["#[derive(Debug, Clone)]", "struct Wrap(u8, String);"] },
  { name: "tuple struct nested parens", src: `struct Logger(()) +Debug`, contains: ["#[derive(Debug)]", "struct Logger(());"] },
  { name: "plain unit struct", src: `struct Clearer;`, contains: ["struct Clearer;"] },
  { name: "generic struct", src: `struct S<T> {v Vec<T>}`, contains: ["struct S<T> {", "v: Vec<T>,"] },
  { name: "enum shorthand single line", src: `enum E +Clone {A(u8), B {x i32, y i32}}`, contains: ["#[derive(Clone)]", "enum E {A(u8), B {x: i32, y: i32}}"] },
  { name: "enum shorthand multi line", src: `enum E {\nA(u8),\nB {x i32},\n}`, contains: ["B {x: i32},"] },
  { name: "match pattern not colonized", src: `fn f(e &E) i32 {\nmatch e {\nE::B {x} => *x,\nE::A(_) => 0,\n}\n}`, contains: ["E::B {x} => *x,"] },
  { name: "const", src: `const N usize = 3`, contains: ["const N: usize = 3;"] },
  // aliases / imports
  { name: "R alias", src: `fn m() R<()> {Ok(())}`, contains: ["-> Result<(), Box<dyn Error>>", "use std::error::Error;"] },
  { name: "nested R alias", src: `fn m() R<Vec<u8>> {Ok(vec![])}`, contains: ["Result<Vec<u8>, Box<dyn Error>>"] },
  { name: "prelude injection", src: `fn main() {\nm := HashMap::new()\nm.insert(1, 2)\n}`, contains: ["use std::collections::HashMap;"] },
  { name: "#use injection", src: `#use std::fmt::Write\nfn main() {\nmut s := String::new()\nwrite!(s, "x").unwrap()\n}`, contains: ["use std::fmt::Write;"] },
  { name: "no duplicate use", src: `#use std::fs\nfn main() {\nt := fs::read_to_string("x")\n}`, counts: [["use std::fs;", 1]] },
  // semicolon heuristics — one case per historical hole
  { name: "for-block statement gets semicolon", src: `fn main() {\nmut m := HashMap::new()\nfor k in 0..3 {\nm.insert(k, k)\n}\n}`, contains: ["m.insert(k, k);"] },
  { name: "value-fn tail keeps no semicolon", src: `fn f() i32 {\nx := 1\nx + 1\n}`, contains: ["x + 1\n"], excludes: ["x + 1;"] },
  { name: "unit-fn tail gets semicolon", src: `fn main() {\nprintln!("hi")\n}`, contains: [`println!("hi");`] },
  { name: "inline let-if gets semicolon", src: `fn main() {\nr := if c {1} else {2}\nuse_it(r)\n}`, contains: ["let r = if c {1} else {2};"] },
  { name: "multiline let-match closer", src: `fn main() {\nr := match t {\nA => 1,\nB => 2,\n}\nuse_it(r)\n}`, contains: ["};"] },
  { name: "multiline vec closer", src: `fn main() {\nmut v := vec![\n1,\n2,\n]\nv.push(3)\n}`, contains: ["];"] },
  { name: "multiline call-closure closer", src: `fn main() {\nfor i in 0..2 {\nthread::spawn(move || {\nwork(i)\n})\n}\n}`, contains: ["});"] },
  { name: "unsafe tail block keeps value", src: `fn f(p *const u8) u8 {\nunsafe {\nx := *p\nx + 1\n}\n}`, contains: ["x + 1\n"], excludes: ["x + 1;", "};"] },
  { name: "match tail in value fn", src: `fn f(e &E) i32 {\nmatch e {\nE::A => 1,\nE::B => 2,\n}\n}`, excludes: ["};"] },
  { name: "value match arm block tail", src: `fn main() {\nr := match t {\nA => {\nx := f()\nx + 1\n}\nB => 0,\n}\nuse_it(r)\n}`, contains: ["x + 1\n"], excludes: ["x + 1;"] },
  { name: "statement match arm gets semicolons", src: `fn main() {\nmatch t {\nA => {\nlog()\ndone()\n}\nB => other(),\n}\n}`, contains: ["log();", "done();"] },
  // leniency & protection
  { name: "lenient trailing semicolon", src: `fn main() {\nx := 1;\n}`, contains: ["let x = 1;"], excludes: [";;"] },
  { name: "turbofish passthrough", src: `fn main() {\nv := xs.collect::<Vec<_>>()\n}`, contains: [".collect::<Vec<_>>()"] },
  { name: "strings fully protected", src: `fn main() {\ns := "let x = 5; fn a() -> b {}"\n}`, contains: [`let s = "let x = 5; fn a() -> b {}";`] },
  { name: "array repeat literal", src: `fn main() {\nmut v := [0u32; 3]\nv[0] = 1\n}`, contains: ["let mut v = [0u32; 3];"] },
  // --- adversarial round 2 ---
  { name: "raw string with quotes protected", src: `fn main() {\ns := r#"He said "hi" := x"#\n}`, contains: [`let s = r#"He said "hi" := x"#;`] },
  { name: "raw string simple protected", src: `fn main() {\ns := r"a := b"\n}`, contains: [`let s = r"a := b";`] },
  { name: "multi-line struct", src: `struct Link +Debug {\ntext String,\nurl String,\nend usize,\n}`, contains: ["#[derive(Debug)]", "text: String,", "url: String,", "end: usize,"] },
  { name: "field attribute passes through", src: `struct Arg {\n#[cfg(feature = "env")]\nenv String,\nname String,\n}`, contains: ["#[cfg(feature = \"env\")]", "env: String,", "name: String,"], excludes: ["#[cfg(feature = \"env\")],"] },
  { name: "variant attribute passes through", src: `enum E {\n#[cfg(test)]\nA {x u8},\nB,\n}`, contains: ["#[cfg(test)]", "A {x: u8},"] },
  { name: "multi-line struct no derive", src: `struct P {\nx f64,\ny f64,\n}`, contains: ["x: f64,", "y: f64,"] },
  { name: "unbalanced brackets inside strings don't corrupt the stack", src: `fn main() {\nassert_eq!(f("a [b"), "a [b")\nassert_eq!(f("x { y ("), "z")\n}`, excludes: ["};"] },
  { name: "char literal paren doesn't corrupt the stack", src: `fn check(c char) bool {\nif c == '(' {\nreturn true\n}\nfalse\n}`, contains: ["false\n}"], excludes: ["false;"] },
  // --- v0.6: priv / macro_rules / arg-position blocks ---
  { name: "priv keyword is stripped from output", src: `priv fn helper() u8 {1}\nfn main() {helper();}`, contains: ["fn helper() -> u8 {1}"], excludes: ["priv"] },
  { name: "macro_rules inline arm keeps separator", src: `macro_rules! maxof {\n($a:expr, $b:expr) => {if $a > $b {$a} else {$b}};\n}`, contains: ["{$a} else {$b}};"] },
  { name: "macro_rules multi-line arm closes with semicolon", src: `macro_rules! trace {\n($m:expr) => {\nv := $m\nprintln!("{v}")\n};\n}`, contains: ["let v = $m;", "    };"] },
  { name: "folded closure with inner match is a statement", src: `fn f(rdr R2) R<()> {\nrdr.for_each(|line| { match go(line) { Ok(v) => { push(v); Ok(true) } Err(e) => Err(e) } })?\nOk(())\n}`, contains: ["} })?;"] },
  { name: "in-body use with braces gets semicolon", src: `fn main() {\nuse std::io::{Read, Write}\ngo()\n}`, contains: ["use std::io::{Read, Write};"] },
  { name: "multiline if-else as fn tail", src: `fn f(ok bool) R<()> {\nif ok {\nprintln!("y")\nOk(())\n} else {\nErr("no".into())\n}\n}`, contains: ["Err(\"no\".into())\n"], excludes: ["Err(\"no\".into());"] },
  { name: "method-chain closer as fn tail", src: `fn f(t &str) String {\nre.replace(t, |c: &Captures| {\nformat!("x{}", &c[1])\n}).to_string()\n}`, contains: [").to_string()\n"], excludes: [").to_string();"] },
  { name: "arg-position async block tail is a value", src: `fn main() {\nh := tokio::spawn(async move {\nfetch(1).await\n})\nh\n}`, contains: ["fetch(1).await\n"], excludes: ["fetch(1).await;"] },
];

// ---------- project cases (buildProject output assertions) ----------

const PROJECT_CASES = [
  {
    name: "priv items and fields stay non-pub",
    files: { lib: `priv fn helper() u8 {1}\nfn open_fn() u8 {helper()}\nstruct S {priv secret u8, open u8}\npriv struct Hidden {x u8}\nimpl S {\npriv fn internal(&self) u8 {self.open}\nfn visible(&self) u8 {self.internal()}\n}` },
    file: "src/lib.rs",
    contains: ["fn helper() -> u8", "pub fn open_fn", "secret: u8,", "pub open: u8,", "struct Hidden {", "fn internal", "pub fn visible"],
    excludes: ["pub fn helper", "pub secret", "pub struct Hidden", "pub fn internal", "priv"],
  },
  {
    name: "test module gets allow(unused_imports)",
    files: { main: `fn main() {println!("{}", one())}`, util: `fn one() u8 {1}`, tests: `#[test]\nfn t() {assert_eq!(one(), 1)}` },
    file: "src/tests.rs",
    contains: ["#![allow(unused_imports)]", "use crate::util::*;"],
  },
  {
    name: "nested modules: main declares dirs, synthetic mod file, nested glob use",
    files: { "main": `fn main() {println!("{}", shout("x"))}`, "util/text": `fn shout(s &str) String {s.to_uppercase()}` },
    file: "src/main.rs",
    contains: ["mod util;", "use crate::util::text::*;"],
  },
  {
    name: "synthetic directory module lists children",
    files: { "main": `fn main() {go()}`, "net/http": `fn go() {}` },
    file: "src/net.rs",
    contains: ["pub mod http;"],
  },
  {
    name: "explicit discriminants reach the JS binding tags",
    files: { lib: `#crate cdylib\n#[repr(C, i32)]\nenum Msg {Ping = 10, Data {x f64} = 20}\n#[no_mangle]\nextern "C" fn touch(m *const Msg) u8 {0}` },
    file: "js/unit-proj.mjs",
    contains: ['"tags":{"Ping":10,"Data":20}'],
  },
];

// ---------- runner ----------

let pass = 0, fail = 0;
const problems = [];

for (const c of DIAG_CASES) {
  const diags = diagnose(c.src);
  const errs = [];
  for (const [rule, line] of c.expect ?? []) {
    if (!diags.some((d) => d.rule === rule && (line === undefined || d.line === line))) {
      errs.push(`expected ${rule}@${line} — got ${diags.map((d) => `${d.rule}@${d.line}`).join(", ") || "none"}`);
    }
  }
  for (const rule of c.forbid ?? []) {
    if (diags.some((d) => d.rule === rule)) errs.push(`forbidden rule ${rule} fired`);
  }
  if (c.ok !== undefined) {
    const ok = !diags.some((d) => d.severity === "error");
    if (ok !== c.ok) errs.push(`ok=${ok}, expected ${c.ok}`);
  }
  if (errs.length) { fail++; problems.push(`DIAG ${c.name}: ${errs.join("; ")}`); } else pass++;
}

for (const c of DOC_CASES) {
  const diags = docCheck(c.ttm, c.sidecar);
  const errs = [];
  for (const rule of c.expect) {
    if (!diags.some((d) => d.rule === rule)) errs.push(`expected ${rule} — got ${diags.map((d) => d.rule).join(", ") || "none"}`);
  }
  for (const d of diags) {
    if (!c.expect.includes(d.rule)) errs.push(`unexpected ${d.rule}`);
  }
  if (errs.length) { fail++; problems.push(`DOC ${c.name}: ${errs.join("; ")}`); } else pass++;
}

for (const c of TRANSFORM_CASES) {
  let out;
  const errs = [];
  try { out = transpile(c.src); } catch (e) { errs.push(`transpile threw: ${e.message}`); }
  if (out !== undefined) {
    for (const s of c.contains ?? []) if (!out.includes(s)) errs.push(`missing ${JSON.stringify(s)}`);
    for (const s of c.excludes ?? []) if (out.includes(s)) errs.push(`must not contain ${JSON.stringify(s)}`);
    for (const [s, n] of c.counts ?? []) {
      const got = out.split(s).length - 1;
      if (got !== n) errs.push(`${JSON.stringify(s)} appears ${got}x, expected ${n}`);
    }
  }
  if (errs.length) { fail++; problems.push(`XFORM ${c.name}: ${errs.join("; ")}\n--- output ---\n${out ?? ""}`); } else pass++;
}

for (const c of PROJECT_CASES) {
  const errs = [];
  let content;
  try {
    const { files } = buildProject(c.files, "unit-proj");
    content = files[c.file];
    if (content === undefined) errs.push(`missing output file ${c.file} (got ${Object.keys(files).join(", ")})`);
  } catch (e) { errs.push(`buildProject threw: ${e.message}`); }
  if (content !== undefined) {
    for (const s of c.contains ?? []) if (!content.includes(s)) errs.push(`missing ${JSON.stringify(s)}`);
    for (const s of c.excludes ?? []) if (content.includes(s)) errs.push(`must not contain ${JSON.stringify(s)}`);
  }
  if (errs.length) { fail++; problems.push(`PROJ ${c.name}: ${errs.join("; ")}\n--- ${c.file} ---\n${content ?? ""}`); } else pass++;
}

for (const p of problems) console.log(`FAIL ${p}\n`);
console.log(`${pass}/${pass + fail} unit cases passed`);
process.exit(fail ? 1 : 0);
