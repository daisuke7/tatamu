### anagram
```rust
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 3 {
        eprintln!("Usage: {} <word1> <word2>", args[0]);
        std::process::exit(1);
    }

    let word1 = args[1].to_lowercase();
    let word2 = args[2].to_lowercase();

    let mut chars1: Vec<char> = word1.chars().collect();
    let mut chars2: Vec<char> = word2.chars().collect();

    chars1.sort_unstable();
    chars2.sort_unstable();

    println!("{}", chars1 == chars2);
}
```

### csvavg
```rust
use std::env;
use std::fs;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 2 {
        eprintln!("Usage: {} <csv_file>", args[0]);
        std::process::exit(1);
    }

    let contents = fs::read_to_string(&args[1])?;
    let lines: Vec<&str> = contents.lines().collect();

    if lines.is_empty() {
        return Err("Empty file".into());
    }

    let mut sum = 0.0;
    let mut count = 0;

    for line in &lines[1..] {
        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() > 1 {
            let value: f64 = fields[1].parse()?;
            sum += value;
            count += 1;
        }
    }

    if count == 0 {
        return Err("No values to average".into());
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
            name: "Apple".to_string(),
            qty: 10,
            price: 1.5,
        },
        Item {
            name: "Banana".to_string(),
            qty: 20,
            price: 0.8,
        },
        Item {
            name: "Orange".to_string(),
            qty: 15,
            price: 2.0,
        },
        Item {
            name: "Mango".to_string(),
            qty: 5,
            price: 3.5,
        },
        Item {
            name: "Grape".to_string(),
            qty: 25,
            price: 1.2,
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
use std::env;
use std::fs;
use std::io;
use std::collections::HashSet;

fn main() -> io::Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 2 {
        eprintln!("Usage: {} <file_path>", args[0]);
        std::process::exit(1);
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

fn fib(n: u32, memo: &mut HashMap<u32, u64>) -> u64 {
    if let Some(&result) = memo.get(&n) {
        return result;
    }

    let result = if n == 1 || n == 2 {
        1
    } else {
        fib(n - 1, memo) + fib(n - 2, memo)
    };

    memo.insert(n, result);
    result
}

fn main() {
    let mut memo = HashMap::new();

    for n in 1..=20 {
        let value = fib(n, &mut memo);
        println!("fib({}) = {}", n, value);
    }
}
```

### rpn
```rust
use std::env;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 2 {
        eprintln!("Usage: {} <expression>", args[0]);
        std::process::exit(1);
    }

    let tokens: Vec<&str> = args[1].split_whitespace().collect();
    let mut stack: Vec<f64> = Vec::new();

    for token in tokens {
        match token {
            "+" | "-" | "*" | "/" => {
                if stack.len() < 2 {
                    return Err("Malformed input: not enough operands".into());
                }
                let b = stack.pop().unwrap();
                let a = stack.pop().unwrap();

                let result = match token {
                    "+" => a + b,
                    "-" => a - b,
                    "*" => a * b,
                    "/" => {
                        if b == 0.0 {
                            return Err("Division by zero".into());
                        }
                        a / b
                    }
                    _ => unreachable!(),
                };

                stack.push(result);
            }
            _ => {
                let num: f64 = token.parse()?;
                stack.push(num);
            }
        }
    }

    if stack.len() != 1 {
        return Err("Malformed input: invalid expression".into());
    }

    println!("{}", stack[0]);
    Ok(())
}
```
