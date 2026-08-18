use std::env;
use std::fs;

const FILE: &str = "todo.txt";

fn load() -> Vec<String> {
    fs::read_to_string(FILE)
        .map(|t| t.lines().map(String::from).collect())
        .unwrap_or_default()
}

fn save(items: &[String]) {
    fs::write(FILE, items.join("\n")).expect("failed to save");
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut items = load();
    match args.first().map(String::as_str) {
        Some("add") => {
            items.push(args[1..].join(" "));
            save(&items);
        }
        Some("done") => {
            let index: usize = args[1].parse().expect("done <index>");
            items.remove(index);
            save(&items);
        }
        _ => {
            for (i, item) in items.iter().enumerate() {
                println!("{i}: {item}");
            }
        }
    }
}
