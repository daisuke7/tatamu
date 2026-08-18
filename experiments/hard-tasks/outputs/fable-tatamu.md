### largest
```
fn largest<T: PartialOrd + Copy>(list &[T]) T {
mut max := list[0]
for &item in list {if item > max {max = item}}
max
}
fn main() {
ints := [3, 7, 2, 9, 4]
floats := [1.5, 0.3, 2.7]
chars := ['m', 'z', 'a']
println!("{}", largest(&ints))
println!("{}", largest(&floats))
println!("{}", largest(&chars))
}
```

### longest
```
fn longest<'a>(x &'a str, y &'a str) &'a str {
if x.len() > y.len() {x} else {y}
}
fn main() {
a := env::args().nth(1).expect("usage: longest <a> <b>")
b := env::args().nth(2).expect("usage: longest <a> <b>")
println!("{}", longest(&a, &b))
}
```

### shapes
```
enum Shape {Circle(f64), Rect(f64, f64)}
impl Shape {
fn area(&self) f64 {
match self {
Shape::Circle(r) => PI * r * r,
Shape::Rect(w, h) => w * h,
}
}
}
fn main() {
shapes := vec![Shape::Circle(1.5), Shape::Rect(3.0, 4.0), Shape::Circle(0.5)]
total: f64 := shapes.iter().map(|s| s.area()).sum()
println!("total area = {total:.2}")
}
```

### hms
```
struct Hms +Debug,Clone,Copy {h u32, m u32, s u32}
impl Display for Hms {
fn fmt(&self, f &mut Formatter<'_>) fmt::Result {
write!(f, "{:02}:{:02}:{:02}", self.h, self.m, self.s)
}
}
impl FromStr for Hms {
type Err = String
fn from_str(s &str) Result<Self, Self::Err> {
parts: Vec<_> := s.split(':').collect()
if parts.len() != 3 {return Err("expected h:m:s".to_string())}
h := parts[0].parse().map_err(|e| format!("bad hours: {e}"))?
m := parts[1].parse().map_err(|e| format!("bad minutes: {e}"))?
s := parts[2].parse().map_err(|e| format!("bad seconds: {e}"))?
Ok(Hms {h, m, s})
}
}
fn main() {
arg := env::args().nth(1).expect("usage: hms <h:m:s>")
hms: Hms := arg.parse().expect("invalid time")
println!("{hms}")
}
```

### threads
```
fn main() {
numbers: Vec<i64> := (1..=1000).collect()
(tx, rx) := mpsc::channel()
mut handles := Vec::new()
for chunk in numbers.chunks(250) {
tx := tx.clone()
chunk := chunk.to_vec()
handles.push(thread::spawn(move || tx.send(chunk.iter().sum::<i64>()).unwrap()))
}
drop(tx)
mut total := 0
for partial in rx {total += partial}
for handle in handles {handle.join().unwrap()}
println!("total = {total}")
}
```

### stack
```
struct Stack<T> {items Vec<T>}
impl<T> Stack<T> {
fn new() Self {Stack {items: Vec::new()}}
fn push(&mut self, item T) {self.items.push(item)}
fn pop(&mut self) Option<T> {self.items.pop()}
fn peek(&self) Option<&T> {self.items.last()}
}
fn main() {
mut ints := Stack::new()
ints.push(1)
ints.push(2)
ints.push(3)
println!("peek: {:?}", ints.peek())
while let Some(n) = ints.pop() {println!("pop: {n}")}
mut words := Stack::new()
words.push("hello".to_string())
words.push("world".to_string())
println!("peek: {:?}", words.peek())
while let Some(w) = words.pop() {println!("pop: {w}")}
}
```
