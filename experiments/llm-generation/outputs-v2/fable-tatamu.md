### anagram
```
fn main() {
mut args := env::args().skip(1)
a := args.next().expect("usage: anagram <word1> <word2>")
b := args.next().expect("usage: anagram <word1> <word2>")
mut x: Vec<_> := a.to_lowercase().chars().collect()
mut y: Vec<_> := b.to_lowercase().chars().collect()
x.sort()
y.sort()
println!("{}", x == y)
}
```

### csvavg
```
fn main() R<()> {
path := env::args().nth(1).ok_or("usage: csvavg <file>")?
text := fs::read_to_string(&path)?
mut sum := 0.0
mut count := 0
for line in text.lines().skip(1) {
field := line.split(',').nth(1).ok_or("missing second column")?
value: f64 := field.trim().parse()?
sum += value
count += 1
}
if count == 0 {return Err("no data rows".into())}
println!("{:.2}", sum / count as f64)
Ok(())
}
```

### inventory
```
struct Item +Debug,Clone {name String, qty u32, price f64}
impl Item {
fn value(&self) f64 {self.qty as f64 * self.price}
}
fn main() {
mut items := vec![Item {name: "hammer".into(), qty: 10, price: 12.5}, Item {name: "nails".into(), qty: 500, price: 0.05}, Item {name: "saw".into(), qty: 3, price: 42.0}, Item {name: "drill".into(), qty: 5, price: 99.99}, Item {name: "tape".into(), qty: 20, price: 3.75}]
items.sort_by(|a, b| b.value().partial_cmp(&a.value()).unwrap())
for item in items.iter().take(3) {println!("{}: {}", item.name, item.value())}
}
```

### dedup
```
fn main() {
path := env::args().nth(1).expect("usage: dedup <file>")
text := fs::read_to_string(&path).expect("failed to read file")
mut seen := HashSet::new()
for line in text.lines() {
if seen.insert(line) {println!("{line}")}
}
}
```

### fib
```
fn fib(n u64, memo &mut HashMap<u64, u64>) u64 {
if n <= 2 {return 1}
if let Some(&v) = memo.get(&n) {return v}
v := fib(n - 1, memo) + fib(n - 2, memo)
memo.insert(n, v)
v
}
fn main() {
mut memo := HashMap::new()
for n in 1..=20 {println!("fib({n}) = {}", fib(n, &mut memo))}
}
```

### rpn
```
fn main() R<()> {
expr := env::args().nth(1).ok_or("usage: rpn <expr>")?
mut stack: Vec<f64> := Vec::new()
for token in expr.split_whitespace() {
if matches!(token, "+" | "-" | "*" | "/") {
b := stack.pop().ok_or("stack underflow")?
a := stack.pop().ok_or("stack underflow")?
if token == "/" && b == 0.0 {return Err("division by zero".into())}
stack.push(match token {"+" => a + b, "-" => a - b, "*" => a * b, _ => a / b})
} else {
stack.push(token.parse()?)
}
}
if stack.len() != 1 {return Err("malformed expression".into())}
println!("{}", stack[0])
Ok(())
}
```
