// Instantiate the Tatamu-built wasm module in Node and call its exports.
// usage: node run-wasm.mjs <path/to/tatamu_ffi.wasm>
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2];
if (!wasmPath) { console.error("usage: node run-wasm.mjs <file.wasm>"); process.exit(1); }

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const { tatamu_add, tatamu_fib, tatamu_gcd } = instance.exports;

console.log("exports:", Object.keys(instance.exports).join(", "));
console.log("add(20, 22)  =", tatamu_add(20n, 22n));   // i64 → BigInt in JS
console.log("fib(50)      =", tatamu_fib(50));
console.log("gcd(48, 180) =", tatamu_gcd(48n, 180n));
