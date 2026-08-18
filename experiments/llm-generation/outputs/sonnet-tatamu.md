### anagram
```
fn main() {
args := env::args().collect()
a := args[1].to_lowercase()
b := args[2].to_lowercase()
mut ac := a.chars().collect()
mut bc := b.chars().collect()
ac.sort()
bc.sort()
println!("{}", ac == bc)
}
```

### csvavg
```
fn main() R<()> {
path := env::args().nth(1).expect("usage: csvavg <file>")
text := fs::read_to_string(&path)?
mut sum := 0.0
mut count := 0
for line in text.lines().skip(1) {
if line.is_empty() {continue}
cols := line.split(',').collect()
value := cols[1].trim().parse()?
sum += value
count += 1
}
avg := sum / count as f64
println!("{avg:.2}")
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
mut items := vec![
Item {name: "Widget".to_string(), qty: 10, price: 2.5},
Item {name: "Gadget".to_string(), qty: 5, price: 12.0},
Item {name: "Gizmo".to_string(), qty: 20, price: 1.75},
Item {name: "Doohickey".to_string(), qty: 3, price: 40.0},
Item {name: "Thingamajig".to_string(), qty: 8, price: 9.99},
]
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
if seen.insert(line.to_string()) {println!("{line}")}
}
}
```

### fib
```
fn fib(n u64, memo &mut HashMap<u64, u64>) u64 {
if n <= 1 {return n}
if let Some(&value) = memo.get(&n) {return value}
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
fn main() R<()> {
expr := env::args().nth(1).expect("usage: rpn <expression>")
mut stack := Vec::new()
for token in expr.split_whitespace() {
if token == "+" || token == "-" || token == "*" || token == "/" {
b := stack.pop().ok_or("stack underflow")?
a := stack.pop().ok_or("stack underflow")?
result := if token == "+" {a + b} else if token == "-" {a - b} else if token == "*" {a * b} else {
if b == 0.0 {return Err("division by zero".into())}
a / b
}
stack.push(result)
} else {
value := token.parse().map_err(|_| "invalid number")?
stack.push(value)
}
}
if stack.len() != 1 {return Err("malformed expression".into())}
println!("{}", stack[0])
Ok(())
}
```
