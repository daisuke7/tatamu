### anagram
```
fn main() {
args: Vec<_> := env::args().collect()
if args.len() < 3 { println!("usage: anagram <word1> <word2>"); return }
word1 := args[1].to_lowercase()
word2 := args[2].to_lowercase()
mut chars1: Vec<_> := word1.chars().collect()
mut chars2: Vec<_> := word2.chars().collect()
chars1.sort()
chars2.sort()
println!("{}", chars1 == chars2)
}
```

### csvavg
```
fn main() R<()> {
path := env::args().nth(1).expect("usage: csvavg <file>")
text := fs::read_to_string(&path)?
mut sum := 0.0
mut count := 0
for (i, line) in text.lines().enumerate() {
if i == 0 { continue }
parts: Vec<_> := line.split(',').collect()
if parts.len() < 2 { continue }
value: f64 := parts[1].trim().parse()?
sum += value
count += 1
}
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
mut items := vec![Item {name: "apple".to_string(), qty: 10, price: 1.5}, Item {name: "banana".to_string(), qty: 20, price: 0.5}, Item {name: "cherry".to_string(), qty: 5, price: 3.0}, Item {name: "date".to_string(), qty: 8, price: 2.0}, Item {name: "elderberry".to_string(), qty: 15, price: 1.2}]
items.sort_by(|a, b| b.value().partial_cmp(&a.value()).unwrap())
for item in items.iter().take(3) { println!("{}: {}", item.name, item.value()) }
}
```

### dedup
```
fn main() R<()> {
path := env::args().nth(1).expect("usage: dedup <file>")
text := fs::read_to_string(&path)?
mut seen := HashSet::new()
for line in text.lines() {
if seen.insert(line) { println!("{}", line) }
}
Ok(())
}
```

### fib
```
fn fib(n u32, memo &mut HashMap<u32, u64>) u64 {
if let Some(&result) = memo.get(&n) { return result }
result := if n <= 1 { n as u64 } else { fib(n - 1, memo) + fib(n - 2, memo) }
memo.insert(n, result)
result
}
fn main() {
mut memo := HashMap::new()
for n in 1..=20 { println!("fib({}) = {}", n, fib(n, &mut memo)) }
}
```

### rpn
```
fn main() R<()> {
expr := env::args().nth(1).expect("usage: rpn <expression>")
mut stack: Vec<f64> := Vec::new()
for token in expr.split_whitespace() {
match token {
"+" => { b := stack.pop().ok_or("stack underflow")?; a := stack.pop().ok_or("stack underflow")?; stack.push(a + b) }
"-" => { b := stack.pop().ok_or("stack underflow")?; a := stack.pop().ok_or("stack underflow")?; stack.push(a - b) }
"*" => { b := stack.pop().ok_or("stack underflow")?; a := stack.pop().ok_or("stack underflow")?; stack.push(a * b) }
"/" => { b := stack.pop().ok_or("stack underflow")?; a := stack.pop().ok_or("stack underflow")?; if b == 0.0 { return Err("division by zero".into()) }; stack.push(a / b) }
_ => { value: f64 := token.parse()?; stack.push(value) }
}
}
result := stack.pop().ok_or("empty stack")?
if !stack.is_empty() { return Err("too many operands".into()) }
println!("{}", result)
Ok(())
}
```
