### anagram
```rust
use std::env;
use std::process;

fn is_anagram(a: &str, b: &str) -> bool {
    let mut a: Vec<char> = a.to_lowercase().chars().collect();
    let mut b: Vec<char> = b.to_lowercase().chars().collect();
    a.sort_unstable();
    b.sort_unstable();
    a == b
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: {} <word1> <word2>", args[0]);
        process::exit(1);
    }
    println!("{}", is_anagram(&args[1], &args[2]));
}
```

### csvavg
```rust
use std::env;
use std::error::Error;
use std::fs;

fn main() -> Result<(), Box<dyn Error>> {
    let path = env::args().nth(1).ok_or("usage: csvavg <file.csv>")?;
    let contents = fs::read_to_string(&path)?;

    let mut sum = 0.0;
    let mut count = 0u32;
    for line in contents.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let field = line
            .split(',')
            .nth(1)
            .ok_or_else(|| format!("missing second column in line: {line}"))?;
        let value: f64 = field.trim().parse()?;
        sum += value;
        count += 1;
    }

    if count == 0 {
        return Err("no data rows".into());
    }
    println!("{:.2}", sum / count as f64);
    Ok(())
}
```

### inventory
```rust
#[derive(Debug, Clone)]
struct Item {
    name: String,
    qty: u32,
    price: f64,
}

impl Item {
    fn value(&self) -> f64 {
        self.qty as f64 * self.price
    }
}

fn main() {
    let mut items = vec![
        Item {
            name: String::from("widget"),
            qty: 10,
            price: 2.50,
        },
        Item {
            name: String::from("gadget"),
            qty: 3,
            price: 19.99,
        },
        Item {
            name: String::from("gizmo"),
            qty: 7,
            price: 4.25,
        },
        Item {
            name: String::from("doodad"),
            qty: 25,
            price: 0.99,
        },
        Item {
            name: String::from("thingamajig"),
            qty: 2,
            price: 49.95,
        },
    ];

    items.sort_by(|a, b| b.value().partial_cmp(&a.value()).unwrap());

    for item in items.iter().take(3) {
        println!("{}: {:.2}", item.name, item.value());
    }
}
```

### dedup
```rust
use std::collections::HashSet;
use std::env;
use std::error::Error;
use std::fs;

fn main() -> Result<(), Box<dyn Error>> {
    let path = env::args().nth(1).ok_or("usage: dedup <file>")?;
    let contents = fs::read_to_string(&path)?;

    let mut seen = HashSet::new();
    for line in contents.lines() {
        if seen.insert(line) {
            println!("{line}");
        }
    }
    Ok(())
}
```

### fib
```rust
use std::collections::HashMap;

fn fib(n: u64, memo: &mut HashMap<u64, u64>) -> u64 {
    if n <= 2 {
        return 1;
    }
    if let Some(&value) = memo.get(&n) {
        return value;
    }
    let value = fib(n - 1, memo) + fib(n - 2, memo);
    memo.insert(n, value);
    value
}

fn main() {
    let mut memo = HashMap::new();
    for n in 1..=20 {
        println!("fib({}) = {}", n, fib(n, &mut memo));
    }
}
```

### rpn
```rust
use std::env;
use std::error::Error;

fn eval(expr: &str) -> Result<f64, Box<dyn Error>> {
    let mut stack: Vec<f64> = Vec::new();

    for token in expr.split_whitespace() {
        match token {
            "+" | "-" | "*" | "/" => {
                let b = stack.pop().ok_or("stack underflow")?;
                let a = stack.pop().ok_or("stack underflow")?;
                let result = match token {
                    "+" => a + b,
                    "-" => a - b,
                    "*" => a * b,
                    "/" => {
                        if b == 0.0 {
                            return Err("division by zero".into());
                        }
                        a / b
                    }
                    _ => unreachable!(),
                };
                stack.push(result);
            }
            _ => {
                let value: f64 = token
                    .parse()
                    .map_err(|_| format!("invalid token: {token}"))?;
                stack.push(value);
            }
        }
    }

    match stack.as_slice() {
        [result] => Ok(*result),
        _ => Err("malformed expression".into()),
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let expr = env::args().nth(1).ok_or("usage: rpn \"<expression>\"")?;
    println!("{}", eval(&expr)?);
    Ok(())
}
```
