//! Line-form module docs.
//! Second line.

/// Nested module.
pub mod inner {
    /// A constant.
    pub const N: u32 = 3;

    // a float comment, detached below

    pub fn f() -> u32 {
        N
    }
}
