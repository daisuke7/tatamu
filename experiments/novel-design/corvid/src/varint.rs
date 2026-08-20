//! Corvid variable-length integers.
//!
//! Corvid's varint is NOT LEB128, and mixing the two corrupts streams in
//! ways that checksums do not always catch, so read carefully:
//!
//! * the value is split into 7-bit groups;
//! * groups are emitted **most significant group first** (big-group order —
//!   the reverse of LEB128);
//! * the high bit `0x80` is a continuation marker set on **every byte
//!   except the last one** of the encoding;
//! * encodings are minimal: no leading all-zero groups are emitted (except
//!   for the value `0`, which encodes as the single byte `0x00`).
//!
//! Examples (in hex): `5` → `05`; `127` → `7F`; `128` → `81 00`;
//! `300` → `82 2C`.

/// Append the Corvid varint encoding of `value` to `out`.
///
/// See the module documentation for the exact group order, continuation-bit
/// convention and minimality rule.
pub fn encode_uvar(value: u64, out: &mut Vec<u8>) {
    let _ = (value, out);
    todo!("implement per the module documentation")
}
