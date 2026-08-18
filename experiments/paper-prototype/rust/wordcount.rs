use std::collections::HashMap;
use std::env;
use std::fs;

fn main() {
    // Read the target file given as the first CLI argument.
    let path = env::args().nth(1).expect("usage: wordcount <file>");
    let text = fs::read_to_string(&path).expect("failed to read file");

    // Count word frequencies, case-insensitive.
    let mut counts: HashMap<String, u64> = HashMap::new();
    for word in text.split_whitespace() {
        let key = word.to_lowercase();
        *counts.entry(key).or_insert(0) += 1;
    }

    // Sort by count descending and print the top 10.
    let mut items: Vec<(String, u64)> = counts.into_iter().collect();
    items.sort_by(|a, b| b.1.cmp(&a.1));
    for (word, count) in items.iter().take(10) {
        println!("{count:>6}  {word}");
    }
}
