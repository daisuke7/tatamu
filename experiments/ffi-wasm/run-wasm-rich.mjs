// String and struct passing between JS and the Tatamu wasm module.
// usage: node run-wasm-rich.mjs <path/to/tatamu_ffi.wasm>
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2];
if (!wasmPath) { console.error("usage: node run-wasm-rich.mjs <file.wasm>"); process.exit(1); }

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const ex = instance.exports;
// memory.buffer detaches when wasm memory grows — always re-read it
const mem = () => new Uint8Array(ex.memory.buffer);
const view = () => new DataView(ex.memory.buffer);

// ---- string round-trip: JS → wasm (ptr+len) → JS (packed u64 ptr<<32|len) ----
const input = "hello tatamu, 畳んで広げる";
const bytes = new TextEncoder().encode(input);
const inPtr = Number(ex.tatamu_alloc(bytes.length));
mem().set(bytes, inPtr);
const packed = ex.tatamu_upper(inPtr, bytes.length);
const outPtr = Number(packed >> 32n);
const outLen = Number(packed & 0xffffffffn);
const result = new TextDecoder().decode(mem().slice(outPtr, outPtr + outLen));
console.log("input :", input);
console.log("output:", result);
ex.tatamu_free(inPtr, bytes.length);
ex.tatamu_free(outPtr, outLen);

// ---- struct passing: two Points in, one Point out, via repr(C) layout ----
const SIZE = 16; // Point {x f64, y f64}
const pA = Number(ex.tatamu_alloc(SIZE));
const pB = Number(ex.tatamu_alloc(SIZE));
const pOut = Number(ex.tatamu_alloc(SIZE));
view().setFloat64(pA, 1.0, true); view().setFloat64(pA + 8, 2.0, true);
view().setFloat64(pB, 5.0, true); view().setFloat64(pB + 8, 8.0, true);
ex.tatamu_midpoint(pA, pB, pOut);
console.log("midpoint of (1,2)-(5,8):", view().getFloat64(pOut, true), view().getFloat64(pOut + 8, true));
for (const p of [pA, pB, pOut]) ex.tatamu_free(p, SIZE);
