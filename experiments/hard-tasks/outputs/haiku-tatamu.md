### largest
```
fn largest<T: PartialOrd + Copy>(list &[T]) T {
mut max := list[0]
for &item in list {
if item > max {
max = item
}
}
max
}
fn main() {
nums_i32: &[i32] := &[3, 7, 2, 9, 1]
nums_f64: &[f64] := &[3.5, 7.2, 2.1, 9.8, 1.3]
nums_char: &[char] := &['c', 'a', 'z', 'b']
println!("largest i32: {}", largest(nums_i32))
println!("largest f64: {}", largest(nums_f64))
println!("largest char: {}", largest(nums_char))
}
```

### longest
```
fn longest<'a>(x &'a str, y &'a str) &'a str {
if x.len() >= y.len() {x} else {y}
}
fn main() {
args: Vec<String> := env::args().collect()
if args.len() < 3 {
println!("usage: longest <string1> <string2>")
return
}
s1 := &args[1]
s2 := &args[2]
result := longest(s1, s2)
println!("longer: {}", result)
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
Shape::Circle(r) => std::f64::consts::PI * r * r,
Shape::Rect(w, h) => w * h,
}
}
}
fn main() {
shapes: Vec<Shape> := vec![
Shape::Circle(2.0),
Shape::Rect(3.0, 4.0),
Shape::Circle(1.0),
]
mut total := 0.0
for shape in &shapes {
total += shape.area()
}
println!("total area: {}", total)
}
```

### hms
```
struct Hms +Debug,Clone {h u32, m u32, s u32}
impl std::fmt::Display for Hms {
fn fmt(&self, f &mut std::fmt::Formatter) std::fmt::Result {
write!(f, "{:02}:{:02}:{:02}", self.h, self.m, self.s)
}
}
impl std::str::FromStr for Hms {
type Err = String
fn from_str(s &str) Result<Self, Self::Err> {
parts: Vec<&str> := s.split(':').collect()
if parts.len() != 3 {
return Err("expected h:m:s format".to_string())
}
h := parts[0].parse::<u32>().map_err(|_| "invalid h".to_string())?
m := parts[1].parse::<u32>().map_err(|_| "invalid m".to_string())?
s := parts[2].parse::<u32>().map_err(|_| "invalid s".to_string())?
Ok(Hms {h, m, s})
}
}
fn main() {
args: Vec<String> := env::args().collect()
if args.len() < 2 {
println!("usage: hms <h:m:s>")
return
}
hms: Hms := args[1].parse().expect("failed to parse")
println!("{}", hms)
}
```

### threads
```
fn main() {
nums: Vec<i64> := (1..=1000).collect()
chunk_size := nums.len() / 4
mut handles := vec![]
(tx, rx) := std::sync::mpsc::channel::<i64>()
for i in 0..4 {
start := i * chunk_size
end := if i == 3 {nums.len()} else {(i + 1) * chunk_size}
chunk: Vec<i64> := nums[start..end].to_vec()
tx_clone := tx.clone()
handle := std::thread::spawn(move || {
sum := chunk.iter().sum::<i64>()
tx_clone.send(sum).unwrap()
})
handles.push(handle)
}
drop(tx)
mut total := 0i64
for sum in rx.iter() {
total += sum
}
for handle in handles {
handle.join().unwrap()
}
println!("total: {}", total)
}
```

### stack
```
struct Stack<T> {items Vec<T>}
impl<T> Stack<T> {
fn push(&mut self, value T) {
self.items.push(value)
}
fn pop(&mut self) Option<T> {
self.items.pop()
}
fn peek(&self) Option<&T> {
self.items.last()
}
}
fn main() {
mut stack_i32: Stack<i32> := Stack {items: vec![]}
stack_i32.push(1)
stack_i32.push(2)
stack_i32.push(3)
println!("peek i32: {:?}", stack_i32.peek())
println!("pop i32: {:?}", stack_i32.pop())
mut stack_str: Stack<String> := Stack {items: vec![]}
stack_str.push("hello".to_string())
stack_str.push("world".to_string())
println!("peek str: {:?}", stack_str.peek())
println!("pop str: {:?}", stack_str.pop())
}
```
