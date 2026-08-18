### anagram
```
fn main() {
mut args := env::args().skip(1)
a := args.next().expect("usage: anagram <word1> <word2>")
b := args.next().expect("usage: anagram <word1> <word2>")
mut x := a.to_lowercase().chars().collect()
mut y := b.to_lowercase().chars().collect()
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
mut count := 0.0
for line in text.lines().skip(1) {
field := line.split(',').nth(1).ok_or("missing second column")?
value := field.trim().parse()?
sum += value
count += 1.0
}
println!("{:.2}", sum / count)
Ok(())
}
```

### inventory
```
struct Item +Debug,Clone {name String, qty u32, price f64}
impl Item {fn value(&self) f64 {self.qty as f64 * self.price}}
fn main() {
mut items := vec![
Item {name: "apple".to_string(), qty: 10, price: 0.5},
Item {name: "banana".to_string(), qty: 150, price: 0.25},
Item {name: "cherry".to_string(), qty: 40, price: 3.0},
Item {name: "date".to_string(), qty: 5, price: 8.0},
Item {name: "elderberry".to_string(), qty: 20, price: 4.5},
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
if seen.insert(line) {println!("{line}")}
}
}
```

### fib
```
fn fib(n u64, memo &mut HashMap<u64, u64>) u64 {
if n <= 2 {return 1}
if memo.contains_key(&n) {return memo[&n]}
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
mut stack := Vec::new()
for token in expr.split_whitespace() {
match token {
"+" | "-" | "*" | "/" => {
b := stack.pop().ok_or("stack underflow")?
a := stack.pop().ok_or("stack underflow")?
result := match token {
"+" => a + b,
"-" => a - b,
"*" => a * b,
_ => {
if b == 0.0 {return Err("division by zero".into())}
a / b
}
}
stack.push(result)
}
_ => stack.push(token.parse()?),
}
}
if stack.len() != 1 {return Err("malformed expression".into())}
println!("{}", stack[0])
Ok(())
}
```
