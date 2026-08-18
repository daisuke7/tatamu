// Token analysis: where do BPE tokens go in real Rust code?
//
// For each sample file:
//   1. Lex the source into character-category spans
//      (keyword / ident / punct / whitespace / comment / string / number)
//   2. Tokenize with each BPE tokenizer (o200k_base, claude-legacy)
//   3. Attribute each BPE token's cost fractionally to the categories of
//      the characters it covers
//
// Output: per-repo and overall aggregates + identifier/keyword/line-type stats.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as o200k from "gpt-tokenizer/encoding/o200k_base";
import { getTokenizer } from "@anthropic-ai/tokenizer";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(HERE, "samples");

// ---------- tokenizer adapters: (text) => string[] (decoded token texts) ----------

const claudeTk = getTokenizer();

function o200kTokens(text) {
  const ids = o200k.encode(text);
  return ids.map((id) => o200k.decode([id]));
}

function claudeTokens(text) {
  const ids = claudeTk.encode(text, "all");
  const dec = new TextDecoder("utf-8", { fatal: false });
  return Array.from(ids).map((id) => dec.decode(claudeTk.decode(new Uint32Array([id]))));
}

const TOKENIZERS = { o200k: o200kTokens, claude_legacy: claudeTokens };

// ---------- Rust lexer (approximate, for statistics) ----------

const KEYWORDS = new Set(
  `as break const continue crate dyn else enum extern false fn for if impl in let
   loop match mod move mut pub ref return self Self static struct super trait true
   type unsafe use where while async await union macro_rules`.split(/\s+/).filter(Boolean)
);

const isIdentStart = (c) => /[A-Za-z_]/.test(c);
const isIdentCont = (c) => /[A-Za-z0-9_]/.test(c);
const isDigit = (c) => /[0-9]/.test(c);
const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";

// Returns an array `cat` with cat[i] = category of source[i].
function lexRust(src) {
  const cat = new Array(src.length);
  let i = 0;
  const mark = (end, c) => { while (i < end) cat[i++] = c; };

  while (i < src.length) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);

    if (c2 === "//") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = src.length;
      mark(j, "comment");
    } else if (c2 === "/*") {
      let depth = 1, j = i + 2;
      while (j < src.length && depth > 0) {
        if (src.slice(j, j + 2) === "/*") { depth++; j += 2; }
        else if (src.slice(j, j + 2) === "*/") { depth--; j += 2; }
        else j++;
      }
      mark(j, "comment");
    } else if (c === '"' || (c === "r" && /^r#*"/.test(src.slice(i)))) {
      if (c === '"') {
        let j = i + 1;
        while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
        mark(Math.min(j + 1, src.length), "string");
      } else {
        const m = /^r(#*)"/.exec(src.slice(i));
        const close = '"' + m[1];
        let j = src.indexOf(close, i + m[0].length);
        j = j === -1 ? src.length : j + close.length;
        mark(j, "string");
      }
    } else if (c === "'") {
      // char literal vs lifetime
      const rest = src.slice(i, i + 6);
      const charLit = /^'(\\.|[^\\'])'/.exec(rest);
      if (charLit) {
        mark(i + charLit[0].length, "string");
      } else {
        let j = i + 1;
        while (j < src.length && isIdentCont(src[j])) j++;
        mark(j, "ident"); // lifetime
      }
    } else if (isDigit(c)) {
      let j = i + 1;
      while (j < src.length) {
        const d = src[j];
        if (/[0-9a-fA-FxXoObB_uUiIfFeE]/.test(d)) j++;
        else if (d === "." && src[j + 1] !== "." && isDigit(src[j + 1] ?? "")) j++;
        else break;
      }
      mark(j, "number");
    } else if (isIdentStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdentCont(src[j])) j++;
      const word = src.slice(i, j);
      mark(j, KEYWORDS.has(word) ? "keyword" : "ident");
    } else if (isSpace(c)) {
      let j = i + 1;
      while (j < src.length && isSpace(src[j])) j++;
      mark(j, "whitespace");
    } else {
      mark(i + 1, "punct");
    }
  }
  return cat;
}

// ---------- line-type classification ----------

function lineType(line) {
  const t = line.trim();
  if (t === "") return "blank";
  if (t.startsWith("//")) return "comment";
  if (/^(pub\s+)?(use|extern crate|mod)\b/.test(t)) return "import_mod";
  if (t.startsWith("#[") || t.startsWith("#![")) return "attribute";
  if (/^[)\]}>,;]+[,;]?$/.test(t)) return "closing_delim";
  return "code";
}

// ---------- analysis ----------

const CATS = ["keyword", "ident", "punct", "whitespace", "comment", "string", "number"];
const files = readdirSync(SAMPLES).filter((f) => f.endsWith(".rs"));

const agg = {}; // tokenizer -> repo -> { files, bytes, chars, tokens, byCat, mismatches }
const identCost = {}; // tokenizer -> identifier -> {occurrences, tokens} (o200k only detail)
const keywordCost = {}; // tokenizer -> {occurrences, tokens}
const lineTypeCost = {}; // tokenizer -> lineType -> tokens

for (const [tkName, tokenize] of Object.entries(TOKENIZERS)) {
  agg[tkName] = {};
  keywordCost[tkName] = { occurrences: 0, tokens: 0 };
  lineTypeCost[tkName] = {};
  identCost[tkName] = new Map();

  for (const file of files) {
    const repo = file.split("__")[0];
    const src = readFileSync(join(SAMPLES, file), "utf8");
    const cat = lexRust(src);
    const toks = tokenize(src);

    const a = (agg[tkName][repo] ??= {
      files: 0, chars: 0, tokens: 0, mismatches: 0,
      byCat: Object.fromEntries(CATS.map((c) => [c, 0])),
    });
    a.files++;
    a.chars += src.length;
    a.tokens += toks.length;

    // verify round-trip; if it fails, skip attribution for this file
    if (toks.join("") !== src) { a.mismatches++; continue; }

    // line-type spans
    const lines = src.split("\n");
    const lineCatByOffset = new Array(src.length);
    {
      let off = 0;
      for (const line of lines) {
        const lt = lineType(line);
        for (let k = 0; k <= line.length && off + k < src.length + 1; k++) lineCatByOffset[off + k] = lt;
        off += line.length + 1;
      }
    }

    // per-identifier occurrence boundaries (for ident cost stats)
    // walk cat[] to find ident spans
    const identSpans = [];
    for (let i = 0; i < src.length; ) {
      if (cat[i] === "ident") {
        let j = i;
        while (j < src.length && cat[j] === "ident" && isIdentCont(src[j])) j++;
        if (j === i) j = i + 1;
        identSpans.push([i, j, src.slice(i, j)]);
        i = j;
      } else i++;
    }

    // fractional attribution of each BPE token to char categories
    let off = 0;
    const tokenSpans = [];
    for (const t of toks) {
      const start = off, end = off + t.length;
      tokenSpans.push([start, end]);
      const counts = {};
      for (let k = start; k < end; k++) {
        counts[cat[k]] = (counts[cat[k]] ?? 0) + 1;
        const lt = lineCatByOffset[k] ?? "code";
        // fractional line-type attribution per char
        lineTypeCost[tkName][lt] = (lineTypeCost[tkName][lt] ?? 0) + 1 / t.length;
      }
      for (const [cName, n] of Object.entries(counts)) {
        a.byCat[cName] += n / t.length;
      }
      off = end;
    }

    // identifier token cost: sum of fractional token cost over each ident span
    for (const [s, e, name] of identSpans) {
      let cost = 0;
      for (const [ts, te] of tokenSpans) {
        if (te <= s) continue;
        if (ts >= e) break;
        const overlap = Math.min(te, e) - Math.max(ts, s);
        cost += overlap / (te - ts);
      }
      const m = identCost[tkName];
      const rec = m.get(name) ?? { occurrences: 0, tokens: 0 };
      rec.occurrences++; rec.tokens += cost;
      m.set(name, rec);
    }

    // keyword cost
    for (let i = 0; i < src.length; ) {
      if (cat[i] === "keyword") {
        let j = i;
        while (j < src.length && cat[j] === "keyword") j++;
        let cost = 0;
        for (const [ts, te] of tokenSpans) {
          if (te <= i) continue;
          if (ts >= j) break;
          cost += (Math.min(te, j) - Math.max(ts, i)) / (te - ts);
        }
        keywordCost[tkName].occurrences++;
        keywordCost[tkName].tokens += cost;
        i = j;
      } else i++;
    }
  }
}

// ---------- report ----------

const out = { generatedNote: "fractional token attribution; see analyze.mjs", tokenizers: {} };

for (const tkName of Object.keys(TOKENIZERS)) {
  const repos = agg[tkName];
  const total = { files: 0, chars: 0, tokens: 0, mismatches: 0, byCat: Object.fromEntries(CATS.map((c) => [c, 0])) };
  for (const r of Object.values(repos)) {
    total.files += r.files; total.chars += r.chars; total.tokens += r.tokens; total.mismatches += r.mismatches;
    for (const c of CATS) total.byCat[c] += r.byCat[c];
  }

  const catShare = Object.fromEntries(
    CATS.map((c) => [c, +(100 * total.byCat[c] / total.tokens).toFixed(1)])
  );

  const topIdents = [...identCost[tkName].entries()]
    .map(([name, r]) => ({ name, occurrences: r.occurrences, totalTokens: +r.tokens.toFixed(1), tokensPerOcc: +(r.tokens / r.occurrences).toFixed(2) }))
    .sort((x, y) => y.totalTokens - x.totalTokens)
    .slice(0, 25);

  const allIdent = [...identCost[tkName].values()].reduce(
    (s, r) => ({ occ: s.occ + r.occurrences, tok: s.tok + r.tokens }), { occ: 0, tok: 0 });

  const ltTotal = Object.values(lineTypeCost[tkName]).reduce((a, b) => a + b, 0);
  const lineTypes = Object.fromEntries(
    Object.entries(lineTypeCost[tkName]).map(([k, v]) => [k, +(100 * v / ltTotal).toFixed(1)])
  );

  out.tokenizers[tkName] = {
    files: total.files,
    chars: total.chars,
    tokens: total.tokens,
    mismatchedFiles: total.mismatches,
    tokensPer100Chars: +(100 * total.tokens / total.chars).toFixed(1),
    categorySharePct: catShare,
    keyword: {
      occurrences: keywordCost[tkName].occurrences,
      avgTokensPerKeyword: +(keywordCost[tkName].tokens / keywordCost[tkName].occurrences).toFixed(2),
      sharePct: catShare.keyword,
    },
    identifier: {
      occurrences: allIdent.occ,
      avgTokensPerIdent: +(allIdent.tok / allIdent.occ).toFixed(2),
      sharePct: catShare.ident,
    },
    lineTypeSharePct: lineTypes,
    topIdentifiersByTotalCost: topIdents,
    perRepo: Object.fromEntries(Object.entries(repos).map(([repo, r]) => [repo, {
      files: r.files,
      tokensPer100Chars: +(100 * r.tokens / r.chars).toFixed(1),
      categorySharePct: Object.fromEntries(CATS.map((c) => [c, +(100 * r.byCat[c] / r.tokens).toFixed(1)])),
    }])),
  };
}

writeFileSync(join(HERE, "results.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
