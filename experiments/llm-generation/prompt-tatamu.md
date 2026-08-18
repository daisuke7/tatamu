# Tatamu language specification (v0.3)

Tatamu is a token-efficient dialect of Rust. It transpiles 1:1 to Rust. Rules:

- No comments, no blank lines, no indentation (every line starts at column 0). A newline terminates a statement; use `;` only to join multiple statements on one line.
- No `use` lines — imports are auto-resolved by the transpiler (write std names directly: HashMap, HashSet, fs, env, ...).
- Bindings: `name := expr` (immutable), `mut name := expr` (mutable). Never use `let` for bindings (`if let` / `while let` pattern matching is fine). Plain `=` is reassignment only.
- Type annotations: exactly where Rust would need them, annotate the binding: `name: Type := expr` (e.g. `items: Vec<_> := iter.collect()`). Turbofish is also allowed when Rust needs it (`.sum::<f64>()`). Where Rust infers fine, write no types.
- Function signatures drop the parameter `:` and the `->`: `fn add(a i64, b i64) i64 { ... }`. Never write `pub` (everything is public by default).
- Struct declaration: `struct Name +Derive1,Derive2 {field1 Type1, field2 Type2}` — derives as a `+List` after the name, fields as `name Type` comma-separated on one line. Struct *literals* keep normal Rust syntax: `Name {field1: value1}`.
- `R<T>` is an alias for `Result<T, Box<dyn Error>>`.
- Generic parameter lists and lifetimes are written exactly as in Rust, right after the name: `fn largest<T: PartialOrd + Copy>(list &[T]) T {`, `fn longest<'a>(x &'a str, y &'a str) &'a str {`, `struct Stack<T> {items Vec<T>}`, `impl<T> Stack<T> {`.
- External crates: declare them with `#dep name version` (or `#dep name version features=a,b`) on their own lines at the top of the file. Refer to crate items by full path (`serde_json::to_string(&x)`) — still no `use` lines. Derives from external crates use qualified paths in the `+List`: `struct P +Debug,serde::Serialize,serde::Deserialize {...}`.
- `enum`: like structs, derives go after the name (`enum Shape +Debug,Clone {...}`) and struct-variant fields use `name Type`: `enum Shape +Debug {Circle(f64), Rect {w f64, h f64}, Empty}`. Tuple/unit variants, `match` patterns, and everything else about enums stay exactly Rust.
- Associated types (`type Err = String`) and trait impls for std traits (Display, FromStr, ...) are written exactly as in Rust (fn signatures inside them still use Tatamu form).
- When a *trait* must be in scope for method syntax to work (e.g. `write!` needs `fmt::Write`), declare it with a `#use` directive line: `#use std::fmt::Write`. This is the only explicit-import mechanism; everything else stays auto-resolved.
- Everything else (expressions, `match`, closures, macros like `println!`/`format!`/`vec!`, `?`, traits, `impl`, `for`/`if`/`else`) is exactly Rust — and everything must compile as Rust after mechanical expansion.

# Examples

## wordcount — print the 10 most frequent words in a file

```
fn main() {
path := env::args().nth(1).expect("usage: wordcount <file>")
text := fs::read_to_string(&path).expect("failed to read file")
mut counts := HashMap::new()
for word in text.split_whitespace() {
key := word.to_lowercase()
*counts.entry(key).or_insert(0) += 1
}
mut items: Vec<_> := counts.into_iter().collect()
items.sort_by(|a, b| b.1.cmp(&a.1))
for (word, count) in items.iter().take(10) {println!("{count:>6}  {word}")}
}
```

## config_parse — parse key=value config into a struct

```
struct Config +Debug,Clone {host String, port u16, verbose bool}
fn parse(text &str) R<Config> {
mut map := HashMap::new()
for line in text.lines() {
line := line.trim()
if line.is_empty() || line.starts_with('#') {continue}
(key, value) := line.split_once('=').ok_or("missing '='")?
map.insert(key.trim().to_string(), value.trim().to_string())
}
Ok(Config {
host: map.get("host").cloned().unwrap_or_else(|| "localhost".into()),
port: map.get("port").map(|v| v.parse()).transpose()?.unwrap_or(8080),
verbose: map.get("verbose").map(|v| v == "true").unwrap_or(false),
})
}
fn main() R<()> {
text := fs::read_to_string("app.conf")?
config := parse(&text)?
println!("{config:?}")
Ok(())
}
```

## geometry — traits, impls, derives

```
trait Area {
fn area(&self) f64
fn describe(&self) String {format!("area = {:.2}", self.area())}
}
struct Circle +Debug,Clone,Copy {radius f64}
struct Rect +Debug,Clone,Copy {width f64, height f64}
impl Area for Circle {fn area(&self) f64 {PI * self.radius * self.radius}}
impl Area for Rect {fn area(&self) f64 {self.width * self.height}}
fn main() {
shapes: Vec<Box<dyn Area>> := vec![Box::new(Circle {radius: 1.5}), Box::new(Rect {width: 3.0, height: 4.0})]
for shape in &shapes {println!("{}", shape.describe())}
}
```
