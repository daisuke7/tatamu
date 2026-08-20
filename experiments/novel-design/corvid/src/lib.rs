//! corvid — reference implementation of the Corvid wire transport.
//!
//! This crate is the canonical Rust implementation of the Corvid protocol
//! suite. The protocol was designed for small embedded links and makes a
//! number of deliberate, non-negotiable choices that differ from common
//! networking conventions; each module documents the parts of the
//! specification it owns. Interoperability with existing Corvid peers
//! requires following those documents to the letter — the wire format is
//! frozen and there is no version negotiation beyond the frame header's
//! version byte.
//!
//! Modules:
//! * [`frame`] — the outer frame layout and its integrity checksum
//! * [`varint`] — the variable-length integer encoding used inside payloads
//! * [`session`] — record sequencing rules for a live session
//! * [`hexutil`] — small debugging helpers (not part of the wire format)

pub mod frame;
pub mod hexutil;
pub mod session;
pub mod varint;
