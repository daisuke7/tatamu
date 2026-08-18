### largest
```
fn largest<T: PartialOrd + Copy>(list &[T]) T {
mut result := list[0]
for &item in list {if item > result {result = item}}
result
}
fn main() {
numbers := vec![34, 50, 25, 100, 65]
println!("largest i32 = {}", largest(&numbers))
floats := vec![1.2, 5.6, 3.3, 9.9, 2.1]
println!("largest f64 = {}", largest(&floats))
chars := vec!['y', 'm', 'a', 'q']
println!("largest char = {}", largest(&chars))
}
```

### longest
```
fn longest<'a>(x &'a str, y &'a str) &'a str {
if x.len() > y.len() {x} else {y}
}
fn main() {
args: Vec<String> := env::args().collect()
if args.len() < 3 {
println!("usage: longest <a> <b>")
return
}
result := longest(&args[1], &args[2])
println!("longest = {result}")
}
```

### shapes
```
enum Shape {
Circle(f64),
Rect(f64, f64),
}
impl Shape {
fn area(&self) f64 {
match self {
Shape::Circle(r) => PI * r * r,
Shape::Rect(w, h) => w * h,
}
}
}
fn main() {
shapes := vec![Shape::Circle(2.0), Shape::Rect(3.0, 4.0), Shape::Circle(1.0)]
total: f64 := shapes.iter().map(|s| s.area()).sum()
println!("total area = {total:.2}")
}
```

### hms
```
struct Hms +Debug,Clone,Copy {h u32, m u32, s u32}
impl fmt::Display for Hms {
fn fmt(&self, f &mut fmt::Formatter) fmt::Result {
write!(f, "{:02}:{:02}:{:02}", self.h, self.m, self.s)
}
}
impl FromStr for Hms {
type Err = String
fn from_str(s &str) Result<Self, Self::Err> {
parts: Vec<&str> := s.split(':').collect()
if parts.len() != 3 {return Err("expected h:m:s".to_string())}
h: u32 := parts[0].parse().map_err(|_| "invalid hour".to_string())?
m: u32 := parts[1].parse().map_err(|_| "invalid minute".to_string())?
s: u32 := parts[2].parse().map_err(|_| "invalid second".to_string())?
Ok(Hms {h, m, s})
}
}
fn main() {
args: Vec<String> := env::args().collect()
if args.len() < 2 {
println!("usage: hms <h:m:s>")
return
}
hms: Hms := args[1].parse().expect("failed to parse hms")
println!("{hms}")
}
```

### threads
```
fn main() {
numbers: Vec<i64> := (1..=1000).collect()
chunk_size := numbers.len() / 4
(tx, rx) := mpsc::channel()
mut handles := Vec::new()
for chunk in numbers.chunks(chunk_size) {
chunk_vec: Vec<i64> := chunk.to_vec()
tx := tx.clone()
handle := thread::spawn(move || {
sum: i64 := chunk_vec.iter().sum()
tx.send(sum).unwrap()
})
handles.push(handle)
}
drop(tx)
for handle in handles {handle.join().unwrap()}
total: i64 := rx.iter().sum()
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
mut int_stack: Stack<i32> := Stack::new()
int_stack.push(1)
int_stack.push(2)
int_stack.push(3)
println!("peek = {:?}", int_stack.peek())
println!("pop = {:?}", int_stack.pop())
mut string_stack: Stack<String> := Stack::new()
string_stack.push("hello".to_string())
string_stack.push("world".to_string())
println!("peek = {:?}", string_stack.peek())
println!("pop = {:?}", string_stack.pop())
}
```
