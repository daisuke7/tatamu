### largest
```
fn largest<T: PartialOrd + Copy>(list &[T]) T {
mut max := list[0]
for &item in list.iter() {
if item > max {max = item}
}
max
}
fn main() {
numbers := [34, 50, 25, 100, 65]
println!("largest i32 = {}", largest(&numbers))
floats := [1.5, 9.25, -3.0, 7.75]
println!("largest f64 = {}", largest(&floats))
chars := ['y', 'm', 'a', 'q']
println!("largest char = {}", largest(&chars))
}
```

### longest
```
fn longest<'a>(x &'a str, y &'a str) &'a str {
if x.len() > y.len() {x} else {y}
}
fn main() {
args: Vec<String> := env::args().skip(1).collect()
if args.len() < 2 {
println!("usage: longest <a> <b>")
return
}
println!("{}", longest(&args[0], &args[1]))
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
shapes := vec![Shape::Circle(1.5), Shape::Rect(3.0, 4.0), Shape::Circle(0.5)]
total := shapes.iter().map(|s| s.area()).sum::<f64>()
for shape in &shapes {println!("area = {:.2}", shape.area())}
println!("total = {total:.2}")
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
type Err = String;
fn from_str(text &str) Result<Self, Self::Err> {
parts: Vec<&str> := text.split(':').collect()
if parts.len() != 3 {return Err(format!("expected h:m:s, got {text:?}"))}
mut values := [0u32; 3]
for (i, part) in parts.iter().enumerate() {
values[i] = part.trim().parse().map_err(|_| format!("bad number: {part:?}"))?
}
if values[1] > 59 || values[2] > 59 {return Err("minutes and seconds must be < 60".to_string())}
Ok(Hms {h: values[0], m: values[1], s: values[2]})
}
}
fn main() R<()> {
arg := env::args().nth(1).ok_or("usage: hms <h:m:s>")?
hms: Hms := arg.parse()?
println!("{hms}")
Ok(())
}
```

### threads
```
fn main() {
data: Vec<i64> := (1..=1000).collect()
chunk_size := data.len() / 4
(sender, receiver) := mpsc::channel()
mut handles := Vec::new()
for chunk in data.chunks(chunk_size) {
part := chunk.to_vec()
tx := sender.clone()
handles.push(thread::spawn(move || {
sum: i64 := part.iter().sum()
tx.send(sum).expect("failed to send partial sum")
}))
}
drop(sender)
for handle in handles {handle.join().expect("thread panicked")}
mut total := 0
for partial in receiver {
println!("partial = {partial}")
total += partial
}
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
fn len(&self) usize {self.items.len()}
}
fn main() {
mut numbers: Stack<i32> := Stack::new()
numbers.push(1)
numbers.push(2)
numbers.push(3)
println!("peek = {:?}", numbers.peek())
println!("pop = {:?}", numbers.pop())
println!("len = {}", numbers.len())
mut words: Stack<String> := Stack::new()
words.push("hello".to_string())
words.push("world".to_string())
println!("peek = {:?}", words.peek())
while let Some(word) = words.pop() {println!("popped {word}")}
println!("empty peek = {:?}", words.peek())
}
```
