// Same demo as run-wasm-rich.mjs, but via the GENERATED JS binding.
// usage: node run-wasm-bound.mjs <builddir>   (expects <builddir>/js/tatamu-ffi.mjs + wasm)
import { readFileSync } from "node:fs";
import { join } from "node:path";

const buildDir = process.argv[2];
const { load, structs } = await import(join(buildDir, "js/tatamu-ffi.mjs"));
const m = await load(readFileSync(join(buildDir, "target/wasm32-unknown-unknown/release/tatamu_ffi.wasm")));

// numbers (i64 args auto-converted to BigInt by the binding)
console.log("add(20, 22)  =", m.tatamu_add(20, 22));
console.log("fib(50)      =", m.tatamu_fib(50));

// strings via the generated helpers
const { ptr, len } = m.writeString("hello tatamu, 畳んで広げる");
console.log("upper        =", m.unpackString(m.tatamu_upper(ptr, len)));
m.free(ptr, len);

// structs via the generated layout descriptors
const a = m.allocStruct(structs.Point, { x: 1, y: 2 });
const b = m.allocStruct(structs.Point, { x: 5, y: 8 });
const out = m.allocStruct(structs.Point);
m.tatamu_midpoint(a, b, out);
console.log("midpoint     =", m.readStruct(structs.Point, out));
for (const p of [a, b, out]) m.freeStruct(structs.Point, p);

// NESTED struct: Segment {a Point, b Point} written/read as one nested object
const seg = m.allocStruct(structs.Segment, { a: { x: 0, y: 0 }, b: { x: 3, y: 4 } });
console.log("seg_len      =", m.tatamu_seg_len(seg));
console.log("seg roundtrip=", JSON.stringify(m.readStruct(structs.Segment, seg)));
m.freeStruct(structs.Segment, seg);
