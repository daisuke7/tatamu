### anagram
```
fn normalize(word &str) Vec<char> {
mut chars := word.to_lowercase().chars().collect()
chars.sort()
chars
}
fn main() {
mut args := env::args().skip(1)
a := args.next().expect("usage: anagram <word1> <word2>")
b := args.next().expect("usage: anagram <word1> <word2>")
println!("{}", normalize(&a) == normalize(&b))
}
```

### csvavg
```
fn main() R<()> {
path := env::args().nth(1).ok_or("usage: csvavg <file.csv>")?
text := fs::read_to_string(&path)?
mut sum := 0.0
mut count := 0
for line in text.lines().skip(1) {
line := line.trim()
if line.is_empty() {continue}
field := line.split(',').nth(1).ok_or("missing second column")?
value := field.trim().parse()?
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
Item {name: "bolt".to_string(), qty: 120, price: 0.35},
Item {name: "hammer".to_string(), qty: 8, price: 12.5},
Item {name: "drill".to_string(), qty: 3, price: 89.99},
Item {name: "tape".to_string(), qty: 40, price: 2.25},
Item {name: "ladder".to_string(), qty: 2, price: 145.0},
]
items.sort_by(|a, b| b.value().partial_cmp(&a.value()).unwrap())
for item in items.iter().take(3) {println!("{}: {:.2}", item.name, item.value())}
}
```

### dedup
```
fn main() R<()> {
path := env::args().nth(1).ok_or("usage: dedup <file>")?
text := fs::read_to_string(&path)?
mut seen := HashSet::new()
for line in text.lines() {
if seen.insert(line) {println!("{line}")}
}
Ok(())
}
```

### fib
```
fn fib(n u64, memo &mut HashMap<u64, u64>) u64 {
if n < 2 {return n}
if let Some(value) = memo.get(&n) {return *value}
result := fib(n - 1, memo) + fib(n - 2, memo)
memo.insert(n, result)
result
}
fn main() {
mut memo := HashMap::new()
for n in 1..=20 {println!("fib({n}) = {}", fib(n, &mut memo))}
}
```

### rpn
```
fn eval(expr &str) R<f64> {
mut stack = Vec::new()
mut stack := Vec::new()
for token in expr.split_whitespace() {
match token {
"+" | "-" | "*" | "/" => {
b := stack.pop().ok_or("stack underflow")?
a := stack.pop().ok_or("stack underflow")?
value := match token {
"+" => a + b,
"-" => a - b,
"*" => a * b,
_ => {
if b == 0.0 {return Err("division by zero".into())}
a / b
}
}
stack.push(value)
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
