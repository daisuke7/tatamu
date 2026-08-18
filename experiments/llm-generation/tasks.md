# Tasks

Write one complete program (std only, no external crates) for each task below.

1. **anagram** — Take two words as CLI arguments and print `true` if they are anagrams of each other (case-insensitive), else `false`.
2. **csvavg** — Take a CSV file path as a CLI argument. Compute the average of the numeric second column (skip the header line) and print it with 2 decimal places. Handle parse failures by returning an error from main.
3. **inventory** — Define a struct `Item` with fields `name` (String), `qty` (u32), `price` (f64), derive Debug and Clone, with a method `value()` returning qty × price. Build a vec of 5 sample items, sort descending by value, print the top 3 as `name: value`.
4. **dedup** — Take a file path as a CLI argument and print its lines with duplicate lines removed, preserving first-occurrence order.
5. **fib** — Compute Fibonacci numbers with a HashMap memo (recursive function taking the memo as parameter). Print `fib(n) = value` for n in 1..=20.
6. **rpn** — Take a reverse-polish-notation expression as a single CLI argument (tokens separated by spaces, operators + - * /). Evaluate it with a stack and print the result. Return an error from main on malformed input or division by zero.
