use std::collections::HashMap;
use std::error::Error;
use std::fs;

#[derive(Debug, Clone)]
struct Config {
    host: String,
    port: u16,
    verbose: bool,
}

fn parse(text: &str) -> Result<Config, Box<dyn Error>> {
    // Collect key=value pairs, ignoring comments and blank lines.
    let mut map = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = line.split_once('=').ok_or("missing '='")?;
        map.insert(key.trim().to_string(), value.trim().to_string());
    }
    Ok(Config {
        host: map.get("host").cloned().unwrap_or_else(|| "localhost".into()),
        port: map.get("port").map(|v| v.parse()).transpose()?.unwrap_or(8080),
        verbose: map.get("verbose").map(|v| v == "true").unwrap_or(false),
    })
}

fn main() -> Result<(), Box<dyn Error>> {
    let text = fs::read_to_string("app.conf")?;
    let config = parse(&text)?;
    println!("{config:?}");
    Ok(())
}
