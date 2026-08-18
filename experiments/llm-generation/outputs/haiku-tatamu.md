### anagram
```
fn main() {
args := env::args().collect::<Vec<_>>();
if args.len() < 3 {eprintln!("usage: anagram <word1> <word2>"); return}
word1 := args[1].to_lowercase();
word2 := args[2].to_lowercase();
mut chars1 := word1.chars().collect::<Vec<_>>();
mut chars2 := word2.chars().collect::<Vec<_>>();
chars1.sort();
chars2.sort();
println!("{}", chars1 == chars2);
}
```

### csvavg
```
fn main() R<()> {
path := env::args().nth(1).ok_or("usage: csvavg <file>")?;
text := fs::read_to_string(&path)?;
mut lines := text.lines();
lines.next();
mut sum := 0.0;
mut count := 0;
for line in lines {
parts := line.split(',').collect::<Vec<_>>();
if parts.len() > 1 {val := parts[1].trim().parse::<f64>()?; sum += val; count += 1}
}
println!("{:.2}", sum / count as f64);
Ok(())
}
```

### inventory
```
struct Item +Debug,Clone {name String, qty u32, price f64}
impl Item {fn value(&self) f64 {self.qty as f64 * self.price}}
fn main() {
mut items := vec![Item {name: "apple".into(), qty: 10, price: 1.5}, Item {name: "banana".into(), qty: 20, price: 0.5}, Item {name: "cherry".into(), qty: 5, price: 3.0}, Item {name: "date".into(), qty: 8, price: 2.0}, Item {name: "elderberry".into(), qty: 12, price: 4.0}];
items.sort_by(|a, b| b.value().partial_cmp(&a.value()).unwrap_or(std::cmp::Ordering::Equal));
for item in items.iter().take(3) {println!("{}: {}", item.name, item.value())}
}
```

### dedup
```
fn main() R<()> {
path := env::args().nth(1).ok_or("usage: dedup <file>")?;
text := fs::read_to_string(&path)?;
mut seen := HashSet::new();
for line in text.lines() {
if seen.insert(line) {println!("{}", line)}
}
Ok(())
}
```

### fib
```
fn fib(n u64, memo &mut HashMap<u64, u64>) u64 {
if let Some(&result) = memo.get(&n) {return result}
result := if n <= 1 {n} else {fib(n - 1, memo) + fib(n - 2, memo)};
memo.insert(n, result);
result
}
fn main() {
mut memo := HashMap::new();
for n in 1..=20 {println!("fib({}) = {}", n, fib(n, &mut memo))}
}
```

### rpn
```
fn main() R<()> {
input := env::args().nth(1).ok_or("usage: rpn <expression>")?;
mut stack := Vec::new();
for token in input.split_whitespace() {
if let Ok(num) = token.parse::<f64>() {stack.push(num)} else {
if stack.len() < 2 {return Err("invalid expression".into())}
b := stack.pop().unwrap();
a := stack.pop().unwrap();
result := match token {"+" => a + b, "-" => a - b, "*" => a * b, "/" => if b == 0.0 {return Err("division by zero".into())} else {a / b}, _ => return Err("unknown operator".into()),};
stack.push(result);
}
}
if stack.len() != 1 {return Err("invalid expression".into())}
println!("{}", stack[0]);
Ok(())
}
```
