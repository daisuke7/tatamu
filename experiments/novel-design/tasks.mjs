// Novel-design tasks: implement functions whose spec exists ONLY in docs
// (the corvid synthetic crate). Reference implementations live here in JS;
// fixtures embed literal expected values computed from them.

// ---- JS reference implementations of the corvid spec ----
export function refChecksum(payload) {
  let s = 0x5a;
  for (const b of payload) s = (((s << 3) | (s >> 5)) & 0xff) ^ b;
  return s;
}
export function refFrame(flags, payload) {
  const len = payload.length;
  return [0xc7, 0xa9, 3, flags, len & 0xff, (len >> 8) & 0xff, ...payload, refChecksum(payload)];
}
export function refUvar(value) {
  // value fits in Number range for our vectors (< 2^50)
  if (value === 0) return [0];
  const groups = [];
  let v = value;
  while (v > 0) {
    groups.unshift(v % 128); // most significant first after unshift
    v = Math.floor(v / 128);
  }
  return groups.map((g, i) => (i < groups.length - 1 ? g | 0x80 : g));
}
export function refSession(payloadLens) {
  const log = [];
  let seq = 7;
  let dataSeen = 0;
  for (const len of payloadLens) {
    log.push({ seq, kind: 0x01, len });
    seq += 2;
    dataSeen++;
    if (dataSeen % 3 === 0) {
      log.push({ seq, kind: 0xee, len: 0 });
      seq += 2;
    }
  }
  return log;
}

// ---- fixture generation ----
const rustArr = (a) => `vec![${a.map((x) => `0x${x.toString(16).padStart(2, "0")}`).join(", ")}]`;

function frameFixture() {
  const payload1 = [0x10, 0x20, 0x30];
  const f1 = refFrame(0x01, payload1);
  const big = Array.from({ length: 300 }, (_, i) => (i * 7 + 0x91) & 0xff);
  const cases = [
    ["empty", 0x00, []],
    ["flags80", 0x80, [0x00, 0x7f, 0xff, 0x5a]],
    ["len300", 0x02, big],
  ];
  let body = `    // field-level checks on one known frame\n    let got = std::panic::catch_unwind(|| corvid::frame::encode_frame(0x01, &[0x10, 0x20, 0x30])).unwrap_or_default();\n`;
  body += `    check("f-magic", got.len() >= 2 && got[0..2] == [0xc7, 0xa9], &mut t, &mut p);\n`;
  body += `    check("f-version", got.len() >= 3 && got[2] == 0x03, &mut t, &mut p);\n`;
  body += `    check("f-flags", got.len() >= 4 && got[3] == 0x01, &mut t, &mut p);\n`;
  body += `    check("f-lenfield", got.len() >= 6 && got[4..6] == [0x03, 0x00], &mut t, &mut p);\n`;
  body += `    check("f-payload", got.len() >= 9 && got[6..9] == [0x10, 0x20, 0x30], &mut t, &mut p);\n`;
  body += `    check("f-checksum", got == ${rustArr(f1)}, &mut t, &mut p);\n`;
  for (const [name, flags, payload] of cases) {
    body += `    let got = std::panic::catch_unwind(|| corvid::frame::encode_frame(0x${flags
      .toString(16)
      .padStart(2, "0")}, &${rustArr(payload).replace("vec!", "")})).unwrap_or_default();\n`;
    body += `    check("f-${name}", got == ${rustArr(refFrame(flags, payload))}, &mut t, &mut p);\n`;
  }
  return body;
}

function varintFixture() {
  const vectors = [0, 5, 127, 128, 300, 16384, 1234567, 2 ** 45 + 12345];
  let body = "";
  for (const v of vectors) {
    body += `    let got = std::panic::catch_unwind(|| { let mut o = Vec::new(); corvid::varint::encode_uvar(${v}u64, &mut o); o }).unwrap_or_default();\n`;
    body += `    check("v-${v}", got == ${rustArr(refUvar(v))}, &mut t, &mut p);\n`;
  }
  return body;
}

function sessionFixture() {
  const lens = [3, 0, 5, 2, 1, 4, 9];
  const log = refSession(lens);
  let body = `    let log = std::panic::catch_unwind(|| {\n        let mut s = corvid::session::Session::new();\n`;
  for (const l of lens) body += `        s.push(&[0u8; ${l}]);\n`;
  body += `        s.log\n    }).unwrap_or_default();\n`;
  body += `    check("s-count", log.len() == ${log.length}, &mut t, &mut p);\n`;
  log.forEach((r, i) => {
    body += `    check("s-${i}", log.len() > ${i} && log[${i}] == corvid::session::Record { seq: ${r.seq}, kind: 0x${r.kind
      .toString(16)
      .padStart(2, "0")}, len: ${r.len} }, &mut t, &mut p);\n`;
  });
  return body;
}

const FIXTURE_TEMPLATE = (body) => `fn check(name: &str, ok: bool, total: &mut u32, pass: &mut u32) {
    *total += 1;
    if ok {
        *pass += 1;
        println!("PASS {name}");
    } else {
        println!("FAIL {name}");
    }
}
fn main() {
    std::panic::set_hook(Box::new(|_| {})); // silence expected todo!() panics
    let (mut t, mut p) = (0u32, 0u32);
${body}    println!("SCORE {p}/{t}");
}
`;

export const MODS = [
  {
    id: "n1-frame",
    target: "frame",
    task: `Implement \`encode_frame\` in \`src/frame.rs\` (replace the \`todo!()\`). The function must produce frames that interoperate with existing Corvid peers.`,
    fixture_main: FIXTURE_TEMPLATE(frameFixture()),
  },
  {
    id: "n2-varint",
    target: "varint",
    task: `Implement \`encode_uvar\` in \`src/varint.rs\` (replace the \`todo!()\`). The encoding must interoperate with existing Corvid peers.`,
    fixture_main: FIXTURE_TEMPLATE(varintFixture()),
  },
  {
    id: "n3-session",
    target: "session",
    task: `Implement \`Session::new\` and \`Session::push\` in \`src/session.rs\` (replace both \`todo!()\`s). The sequencing must match what existing Corvid peers predict.`,
    fixture_main: FIXTURE_TEMPLATE(sessionFixture()),
  },
];
