### anagram
```rust
use std::env;
use std::process;

fn normalize(word: &str) -> Vec<char> {
    let mut chars: Vec<char> = word.to_lowercase().chars().collect();
    chars.sort_unstable();
    chars
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 3 {
        eprintln!("Usage: {} <word1> <word2>", args[0]);
        process::exit(1);
    }

    let is_anagram = normalize(&args[1]) == normalize(&args[2]);
    println!("{}", is_anagram);
}
```

### csvavg
```rust
use std::env;
use std::error::Error;
use std::fs;
use std::process;

fn main() {
    if let Err(e) = run() {
        eprintln!("Error: {}", e);
        process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 2 {
        return Err(format!("Usage: {} <csv_path>", args[0]).into());
    }

    let contents = fs::read_to_string(&args[1])?;
    let mut lines = contents.lines();
    lines.next(); // skip header

    let mut sum = 0.0;
    let mut count = 0u64;

    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(',').collect();
        let value_str = fields
            .get(1)
            .ok_or_else(|| format!("missing second column in line: {}", line))?;
        let value: f64 = value_str
            .trim()
            .parse()
            .map_err(|e| format!("failed to parse '{}' as number: {}", value_str, e))?;
        sum += value;
        count += 1;
    }

    if count == 0 {
        return Err("no data rows found".into());
    }

    let average = sum / count as f64;
    println!("{:.2}", average);
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
            name: "Widget".to_string(),
            qty: 10,
            price: 2.50,
        },
        Item {
            name: "Gadget".to_string(),
            qty: 3,
            price: 19.99,
        },
        Item {
            name: "Gizmo".to_string(),
            qty: 25,
            price: 1.20,
        },
        Item {
            name: "Doohickey".to_string(),
            qty: 7,
            price: 8.75,
        },
        Item {
            name: "Thingamajig".to_string(),
            qty: 1,
            price: 99.99,
        },
    ];

    items.sort_by(|a, b| b.value().partial_cmp(&a.value()).unwrap());

    for item in items.iter().take(3) {
        println!("{}: {}", item.name, item.value());
    }
}
```

### dedup
```rust
use std::collections::HashSet;
use std::env;
use std::error::Error;
use std::fs;
use std::process;

fn main() {
    if let Err(e) = run() {
        eprintln!("Error: {}", e);
        process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 2 {
        return Err(format!("Usage: {} <file_path>", args[0]).into());
    }

    let contents = fs::read_to_string(&args[1])?;
    let mut seen = HashSet::new();

    for line in contents.lines() {
        if seen.insert(line) {
            println!("{}", line);
        }
    }

    Ok(())
}
```

### fib
```rust
use std::collections::HashMap;

fn fib(n: u64, memo: &mut HashMap<u64, u64>) -> u64 {
    if n <= 1 {
        return n;
    }
    if let Some(&value) = memo.get(&n) {
        return value;
    }
    let result = fib(n - 1, memo) + fib(n - 2, memo);
    memo.insert(n, result);
    result
}

fn main() {
    let mut memo: HashMap<u64, u64> = HashMap::new();
    for n in 1..=20u64 {
        println!("fib({}) = {}", n, fib(n, &mut memo));
    }
}
```

### rpn
```rust
use std::env;
use std::error::Error;
use std::process;

fn main() {
    if let Err(e) = run() {
        eprintln!("Error: {}", e);
        process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 2 {
        return Err(format!("Usage: {} <rpn_expression>", args[0]).into());
    }

    let mut stack: Vec<f64> = Vec::new();

    for token in args[1].split_whitespace() {
        match token {
            "+" | "-" | "*" | "/" => {
                let b = stack.pop().ok_or("stack underflow: not enough operands")?;
                let a = stack.pop().ok_or("stack underflow: not enough operands")?;
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
                    .map_err(|e| format!("failed to parse '{}' as number: {}", token, e))?;
                stack.push(value);
            }
        }
    }

    if stack.len() != 1 {
        return Err("malformed expression: leftover operands".into());
    }

    println!("{}", stack[0]);
    Ok(())
}
```
