//! Debugging helpers. Not part of the wire format.

/// Render `bytes` as lowercase hex separated by spaces.
pub fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 3);
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Parse the format produced by [`hex`]. Returns `None` on malformed input.
pub fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.is_empty() {
        return Some(Vec::new());
    }
    s.split(' ').map(|t| u8::from_str_radix(t, 16).ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let v = vec![0x00, 0x7f, 0xff];
        assert_eq!(unhex(&hex(&v)), Some(v));
        assert_eq!(unhex("zz"), None);
        assert_eq!(hex(&[]), "");
    }
}
