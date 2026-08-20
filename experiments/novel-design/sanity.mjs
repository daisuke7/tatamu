// Sanity: Rust reference solutions must score 100%; conventional guesses
// (LEB128, network byte order, checksum-over-everything, seq-from-0) must
// score partial; untouched todo!() must score 0 without crashing the grader.
process.env.NOVEL_DESIGN_LIB = "1";
const { grade } = await import("./run.mjs");
const { MODS } = await import("./tasks.mjs");
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(HERE, "corvid/src", `${f}.rs`), "utf8");

const swapTodo = (file, marker, body) => {
  const s = src(file);
  if (!s.includes(marker)) throw new Error(`marker missing in ${file}`);
  return s.replace(marker, body);
};

// ---- reference solutions ----
const FRAME_REF = `{
    let mut out = Vec::with_capacity(7 + payload.len());
    out.extend_from_slice(&MAGIC);
    out.push(VERSION);
    out.push(flags);
    let len = payload.len() as u16;
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(payload);
    let mut state: u8 = 0x5A;
    for &b in payload {
        state = state.rotate_left(3) ^ b;
    }
    out.push(state);
    out
}`;
const FRAME_GUESS = `{
    // conventional guess: big-endian length incl. header, checksum over all
    let mut out = Vec::new();
    out.extend_from_slice(&MAGIC);
    out.push(VERSION);
    out.push(flags);
    let len = (payload.len() + 7) as u16;
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(payload);
    let mut state: u8 = 0;
    for &b in &out {
        state ^= b;
    }
    out.push(state);
    out
}`;
const frameBody = (impl_) => swapTodo(
  "frame",
  `{
    let _ = (flags, payload);
    todo!("implement per the module documentation")
}`,
  impl_
);

const VARINT_REF = `{
    if value == 0 {
        out.push(0);
        return;
    }
    let mut groups = Vec::new();
    let mut v = value;
    while v > 0 {
        groups.push((v & 0x7F) as u8);
        v >>= 7;
    }
    groups.reverse();
    let last = groups.len() - 1;
    for (i, g) in groups.into_iter().enumerate() {
        out.push(if i < last { g | 0x80 } else { g });
    }
}`;
const VARINT_GUESS = `{
    // conventional guess: standard LEB128
    let mut v = value;
    loop {
        let mut b = (v & 0x7F) as u8;
        v >>= 7;
        if v != 0 {
            b |= 0x80;
        }
        out.push(b);
        if v == 0 {
            break;
        }
    }
}`;
const varintBody = (impl_) => swapTodo(
  "varint",
  `{
    let _ = (value, out);
    todo!("implement per the module documentation")
}`,
  impl_
);

const SESSION_REF = (start, step, every) => {
  let s = src("session");
  s = s.replace(
    `    pub fn new() -> Session {
        todo!("implement per the module documentation")
    }`,
    `    pub fn new() -> Session {
        Session { log: Vec::new(), seq: ${start}, data_seen: 0 }
    }`
  );
  s = s.replace(
    `    pub fn push(&mut self, payload: &[u8]) {
        let _ = payload;
        todo!("implement per the module documentation")
    }`,
    `    pub fn push(&mut self, payload: &[u8]) {
        self.log.push(Record { seq: self.seq, kind: KIND_DATA, len: payload.len() });
        self.seq += ${step};
        self.data_seen += 1;
        if self.data_seen % ${every} == 0 {
            self.log.push(Record { seq: self.seq, kind: KIND_HEARTBEAT, len: 0 });
            self.seq += ${step};
        }
    }`
  );
  return s;
};

const cases = [
  ["n1-frame", frameBody(FRAME_REF), "perfect"],
  ["n1-frame", frameBody(FRAME_GUESS), "partial"],
  ["n1-frame", src("frame"), "zero"],
  ["n2-varint", varintBody(VARINT_REF), "perfect"],
  ["n2-varint", varintBody(VARINT_GUESS), "partial"],
  ["n2-varint", src("varint"), "zero"],
  ["n3-session", SESSION_REF(7, 2, 3), "perfect"],
  ["n3-session", SESSION_REF(0, 1, 3), "partial"], // seq-from-0 step-1 guess
  ["n3-session", src("session"), "zero"],
];

let bad = 0;
for (const [id, code, expect] of cases) {
  const mod = MODS.find((m) => m.id === id);
  const g = grade(mod, code, `sanity-${id}-${expect}-${Math.random().toString(36).slice(2, 6)}`);
  const kind = g.gate === "build" ? "BUILD" : g.score === g.total ? "perfect" : g.score === 0 ? "zero" : "partial";
  const ok = kind === expect;
  console.log(`${id} expect=${expect}: ${ok ? "SANE" : "BROKEN"} (${g.gate === "build" ? "build-fail" : `${g.score}/${g.total}`}) failed=[${g.failed.slice(0, 6)}]`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
