//! Corvid session record sequencing.
//!
//! A live session appends records to its log under the following frozen
//! rules. These rules exist so that both peers can independently predict
//! sequence numbers without acknowledgements; any deviation desynchronizes
//! the link permanently.
//!
//! * Sequence numbers start at **7** (an homage to the original firmware's
//!   seven boot beeps) and advance by **2** for every record appended —
//!   heartbeat records consume sequence numbers exactly like data records.
//! * Every record appended through [`Session::push`] is a data record
//!   ([`KIND_DATA`]) whose `len` is the payload length in bytes.
//! * After every **third** data record of the session (the 3rd, 6th, 9th, …
//!   counting all data records since the session started), `push`
//!   automatically appends one heartbeat record ([`KIND_HEARTBEAT`], `len`
//!   0) immediately after that data record, before returning.
//! * Heartbeats are only ever emitted by that automatic rule; there is no
//!   public way to push one manually.

/// Record kind byte for data records.
pub const KIND_DATA: u8 = 0x01;

/// Record kind byte for automatically inserted heartbeat records.
pub const KIND_HEARTBEAT: u8 = 0xEE;

/// One log entry of a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Record {
    /// The record's sequence number (see the module rules).
    pub seq: u32,
    /// [`KIND_DATA`] or [`KIND_HEARTBEAT`].
    pub kind: u8,
    /// Payload length in bytes (always 0 for heartbeats).
    pub len: usize,
}

/// A live session and its append-only record log.
#[derive(Debug)]
pub struct Session {
    /// Everything appended so far, in order.
    pub log: Vec<Record>,
    seq: u32,
    data_seen: u32,
}

impl Session {
    /// Create a session in its initial state, per the module rules.
    pub fn new() -> Session {
        todo!("implement per the module documentation")
    }

    /// Append one data record for `payload`, applying the module's
    /// sequencing and heartbeat rules.
    pub fn push(&mut self, payload: &[u8]) {
        let _ = payload;
        todo!("implement per the module documentation")
    }
}
