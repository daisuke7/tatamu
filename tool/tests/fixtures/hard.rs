// preamble comment sitting above the module docs
// (second preamble line)

/*!
Module docs in block form.

With a blank line and `inline code`.
*/

use core::fmt;

/// Twin under std.
#[cfg(feature = "std")]
pub fn twin() -> u32 {
    1
}

/// Twin without std.
#[cfg(not(feature = "std"))]
pub fn twin() -> u32 {
    2
}

/// Docs above a multi-line attribute.
#[cfg_attr(
    feature = "std",
    allow(dead_code)
)]
pub struct Multi {
    /// field doc
    pub a: u32,  // aligned tail
    pub b: u32,      // extra-aligned tail
}

/// See https://docs.rs/linked-hash-map/*/linked_hash_map/struct.LinkedHashMap.html
pub enum E {
    /// Variant docs.
    Var {
        /// struct-variant field doc
        head: u32,
    },
    Plain,
}

/**
Block-form docs for a wrapped impl.

 * classic leading-star bullet
*/
impl<T> Wrapped<T>
where
    T: fmt::Debug,
    T: Clone,
{
    /** one-line block doc */
    pub fn m(&self) {
        /// fn-local item docs
        struct Local;
        let _ = Local;
        // SAFETY: kept inline
        // and its continuation line
        let x = &1u32;
        let _y =
            *x;
    }
}

/// macro docs survive
macro_rules! mac {
    () => {};
}

pub struct Wrapped<T>(pub T);

/* kept plain block comment
spanning two lines */

fn tail_owner() {
        // over-indented comment
    let _v = 1; /* inline kept */ let _w = 2;
}

// EOF trailing comment
