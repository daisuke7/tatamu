# Hard tasks

Write one complete program (std only, no external crates) for each task below.

1. **largest** — Generic function `largest<T: PartialOrd + Copy>` returning the largest element of a slice. In main, demonstrate with an i32 slice, an f64 slice, and a char slice.
2. **longest** — Function `longest<'a>` taking two `&'a str` and returning the longer one (explicit lifetime annotations required). main compares two CLI arguments.
3. **shapes** — Enum `Shape` with variants `Circle(f64)` and `Rect(f64, f64)`, a method `area()` implemented with `match`, and main summing the areas of a `Vec<Shape>`.
4. **hms** — Struct `Hms {h, m, s}` implementing BOTH `Display` (as `HH:MM:SS` zero-padded) and `FromStr` (parsing `"h:m:s"`, `type Err = String`). main parses one CLI argument and prints it back.
5. **threads** — Split a `Vec<i64>` of 1..=1000 into 4 chunks, sum each chunk in its own thread (`std::thread`), send partial sums over an `mpsc` channel, and print the total.
6. **stack** — Generic struct `Stack<T>` (Vec-backed) with `push`, `pop`, and `peek` methods via `impl<T>`. main demonstrates with a stack of i32 and a stack of String.
