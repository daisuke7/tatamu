### anagram
```
fn main() {
mut args := env::args().skip(1)
first := args.next().expect("usage: anagram <word1> <word2>")
second := args.next().expect("usage: anagram <word1> <word2>")
mut a: Vec<char> := first.to_lowercase().chars().collect()
mut b: Vec<char> := second.to_lowercase().chars().collect()
a.sort()
b.sort()
println!("{}", a == b)
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
if line.trim().is_empty() {continue}
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
impl Item {fn value(&self) f64 {self.qty as f64 * self.price}}
fn main() {
mut items := vec![
Item {name: "bolt".to_string(), qty: 120, price: 0.25},
Item {name: "hammer".to_string(), qty: 8, price: 14.5},
Item {name: "drill".to_string(), qty: 3, price: 89.99},
Item {name: "tape".to_string(), qty: 40, price: 2.75},
Item {name: "ladder".to_string(), qty: 2, price: 120.0},
]
items.sort_by(|a, b| b.value().partial_cmp(&a.value()).unwrap())
for item in items.iter().take(3) {println!("{}: {:.2}", item.name, item.value())}
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
if let Some(value) = memo.get(&n) {return *value}
value := fib(n - 1, memo) + fib(n - 2, memo)
memo.insert(n, value)
value
}
fn main() {
mut memo := HashMap::new()
for n in 1..=20 {println!("fib({n}) = {}", fib(n, &mut memo))}
}
```

### rpn
```
fn eval(expr &str) R<f64> {
mut stack: Vec<f64> := Vec::new()
for token in expr.split_whitespace() {
match token {
"+" | "-" | "*" | "/" => {
b := stack.pop().ok_or("stack underflow")?
a := stack.pop().ok_or("stack underflow")?
result := match token {
"+" => a + b,
"-" => a - b,
"*" => a * b,
_ => {if b == 0.0 {return Err("division by zero".into())}; a / b}
}
stack.push(result)
}
_ => stack.push(token.parse()?),
}
}
if stack.len() != 1 {return Err("malformed expression".into())}
Ok(stack[0])
}
fn main() R<()> {
expr := env::args().nth(1).ok_or("usage: rpn <expression>")?
println!("{}", eval(&expr)?)
Ok(())
}
```
