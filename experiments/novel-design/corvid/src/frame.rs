//! Corvid frame layout.
//!
//! Every message on a Corvid link travels inside exactly one frame. The
//! layout, in order, is:
//!
//! 1. the two magic bytes [`MAGIC`]
//! 2. the protocol version byte ([`VERSION`])
//! 3. one flags byte (passed through untouched; the frame layer assigns no
//!    meaning to individual bits)
//! 4. the payload length as a **16-bit little-endian** integer — that is,
//!    the least significant byte is transmitted first. Note that this is the
//!    opposite of conventional network byte order; the original Corvid MCU
//!    was little-endian and the choice stuck. The length counts the
//!    **payload bytes only** — the six framing bytes (magic, version, flags,
//!    length) and the trailing checksum are NOT included in it.
//! 5. the payload bytes themselves
//! 6. a single trailing checksum byte (see below)
//!
//! # Checksum
//!
//! The checksum is Corvid's "rot-xor" over the **payload only** — the header
//! bytes are deliberately excluded, so that a frame can be re-flagged in
//! flight without recomputing the checksum. Starting from the initial state
//! `0x5A`, each payload byte is folded in by first rotating the state left
//! by 3 bits and then XOR-ing the byte:
//!
//! ```text
//! state = 0x5A
//! for byte in payload:
//!     state = rotate_left(state, 3) ^ byte
//! ```
//!
//! The final state is the checksum. An empty payload therefore carries the
//! checksum `0x5A`.

/// The two magic bytes that open every Corvid frame.
pub const MAGIC: [u8; 2] = [0xC7, 0xA9];

/// The frozen protocol version emitted by this implementation.
pub const VERSION: u8 = 3;

/// Encode one frame around `payload`.
///
/// Follows the module-level layout exactly; see the module docs for the
/// field order, the length field's width, byte order and coverage, and the
/// checksum algorithm. `flags` is written through as-is.
///
/// Payloads longer than `u16::MAX` bytes are a caller error; this
/// implementation may truncate or panic on them, peers never send them.
pub fn encode_frame(flags: u8, payload: &[u8]) -> Vec<u8> {
    let _ = (flags, payload);
    todo!("implement per the module documentation")
}
