### anagram
```rust
use std::env;
use std::process;

/// Returns the sorted, lowercased characters of `word`, its anagram signature.
fn signature(word: &str) -> Vec<char> {
    let mut chars: Vec<char> = word.to_lowercase().chars().collect();
    chars.sort_unstable();
    chars
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 2 {
        eprintln!("usage: anagram <word1> <word2>");
        process::exit(1);
    }

    println!("{}", signature(&args[0]) == signature(&args[1]));
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

    // `skip(1)` drops the header; `enumerate` is offset by 2 for 1-based line numbers.
    for (index, line) in contents.lines().skip(1).enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        let line_number = index + 2;
        let field = line
            .split(',')
            .nth(1)
            .ok_or_else(|| format!("line {line_number}: missing second column"))?
            .trim();
        let value: f64 = field
            .parse()
            .map_err(|err| format!("line {line_number}: cannot parse {field:?}: {err}"))?;

        sum += value;
        count += 1;
    }

    if count == 0 {
        return Err(format!("{path}: no data rows").into());
    }

    println!("{:.2}", sum / f64::from(count));
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
    fn new(name: &str, qty: u32, price: f64) -> Self {
        Self {
            name: name.to_string(),
            qty,
            price,
        }
    }

    fn value(&self) -> f64 {
        f64::from(self.qty) * self.price
    }
}

fn main() {
    let mut items = vec![
        Item::new("widget", 12, 2.50),
        Item::new("gasket", 140, 0.35),
        Item::new("flywheel", 3, 89.99),
        Item::new("bearing", 48, 4.25),
        Item::new("housing", 7, 31.00),
    ];

    items.sort_by(|a, b| b.value().total_cmp(&a.value()));

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
use std::fs::File;
use std::io::{BufRead, BufReader};

fn main() -> Result<(), Box<dyn Error>> {
    let path = env::args().nth(1).ok_or("usage: dedup <file>")?;
    let reader = BufReader::new(File::open(&path)?);

    let mut seen: HashSet<String> = HashSet::new();
    for line in reader.lines() {
        let line = line?;
        if seen.insert(line.clone()) {
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
    if n < 2 {
        return n;
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

fn eval(expr: &str) -> Result<f64, String> {
    let mut stack: Vec<f64> = Vec::new();

    for token in expr.split_whitespace() {
        match token {
            "+" | "-" | "*" | "/" => {
                let rhs = stack
                    .pop()
                    .ok_or_else(|| format!("operator {token:?}: not enough operands"))?;
                let lhs = stack
                    .pop()
                    .ok_or_else(|| format!("operator {token:?}: not enough operands"))?;

                let value = match token {
                    "+" => lhs + rhs,
                    "-" => lhs - rhs,
                    "*" => lhs * rhs,
                    "/" if rhs == 0.0 => return Err("division by zero".to_string()),
                    "/" => lhs / rhs,
                    _ => unreachable!("operator set is exhaustive"),
                };
                stack.push(value);
            }
            operand => {
                let value: f64 = operand
                    .parse()
                    .map_err(|_| format!("invalid token {operand:?}"))?;
                stack.push(value);
            }
        }
    }

    match stack.as_slice() {
        [value] => Ok(*value),
        [] => Err("empty expression".to_string()),
        _ => Err(format!("{} leftover operands", stack.len() - 1)),
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let expr = env::args().nth(1).ok_or("usage: rpn \"3 4 +\"")?;
    println!("{}", eval(&expr)?);
    Ok(())
}
```
