# Tatamu (畳む)

*English / [日本語](#tatamu畳む--日本語)*

A proof-of-concept language that transpiles 1:1 to Rust, designed AI-first: for teams that want to maximize LLM development efficiency on large Rust codebases, even at the cost of human writability.

- **Fold (畳む)**: dramatically fewer tokens than Rust — measured **−42.2%** vs handwritten idiomatic Rust, 27–45% vs LLM-generated Rust
- **Unfold**: `tatamuc` mechanically expands to plain Rust / cargo projects; semantics are identical to Rust
- **AI efficiency ≥ Rust**: compression is limited to mechanically reversible shorthand, so LLM knowledge of Rust transfers directly (measured: 4 Claude models, 24/24 compile success = same as raw Rust, zero rule violations)

```
fn main() R<()> {
text := fs::read_to_string("app.conf")?
mut counts := HashMap::new()
for word in text.split_whitespace() {*counts.entry(word).or_insert(0) += 1}
println!("{counts:?}")
Ok(())
}
```

## Usage

### Writing Tatamu with an LLM

There is no editor plugin or package registry. The intended workflow is **manual copy** of two files into your LLM context / system prompt:

1. **Rule file (compressed spec with few-shot examples)**: [`experiments/llm-generation/prompt-tatamu.md`](experiments/llm-generation/prompt-tatamu.md) — paste into the model's context; this alone is enough for frontier models to write valid Tatamu
2. **Full language spec (with a Rust-difference table)**: [`docs/tatamu-spec.md`](docs/tatamu-spec.md) — the authoritative reference, for humans and for deeper LLM sessions

Then run the tools below on the generated `.ttm` files.

### Tools

| Tool | Purpose |
|---|---|
| `transpiler/tatamuc.mjs` | The transpiler. Modes: expand (default), `--check` (diagnostics as JSON with fix suggestions), `--compile` (rustc/cargo type-check, errors mapped back to `.ttm` coordinates), `--project` (generate a cargo project: `.rs` + C header + JS/TS/Dart bindings), `--header`, `--jsbind`, `--dts`, `--dartbind`, `--docs` (merge sidecar docs/comments back into Rust), `--doc-check` / `--doc-sync` (sidecar freshness) |
| `dogfood/rust2ttm/` | **Rust → Tatamu converter** (written in Tatamu itself, syn-based). Subcommands: `convert` (Rust dir → `.ttm` + doc/comment sidecars), `compare` (normalized-AST equivalence of two Rust files) |
| `dogfood/rust2ttm/verify-roundtrip.sh` | One-command gate: Rust → Tatamu → Rust, all files verified AST-equivalent |
| `experiments/rust2ttm-coverage/measure.mjs` | Whole-crate round-trip measurement (per-file convert → expand → compare) |
| `experiments/rust2ttm-coverage/diag.mjs` | Single-file round-trip diagnosis with rustc-located errors |
| `transpiler/unit-tests.mjs` | Unit corpus (158 cases: every bug fix has a minimal repro) |
| `transpiler/test.mjs` | Sanity corpus (29 programs) |
| `transpiler/compile-test.mjs` | rustc type-check corpus (requires Rust) |

```sh
node transpiler/tatamuc.mjs file.ttm             # expand to Rust
node transpiler/tatamuc.mjs --check file.ttm     # diagnostics (JSON, LLM-oriented fixes)
node transpiler/tatamuc.mjs --compile <file|dir> # type-check, errors at .ttm coordinates
node transpiler/tatamuc.mjs --project src out    # cargo project + FFI bindings
```

## Current stage & roadmap

Staged plan ([docs/00](docs/00-concept.md)): dialect → own semantics → own compiler → ecosystem.

- **Stage 1 (Rust token-saving dialect): gate cleared.** Token reduction ≥30% measured (27–45%, −42.2% vs handwritten Rust); LLM compile success 24/24 = raw Rust baseline
- **Stage 2 (AI-oriented features): implemented, gate pending.** Structured diagnostics, project generation, out-of-band docs/comment ledger (AST-path anchors), C/JS/TS/Dart FFI, wasm/mobile targets are all built and verified. The gate — *measured improvement* in generation success or fix-loop count over the dialect alone — has not been formally tested yet; this is the next milestone
- **Stage 3 (independent processing): not started, by design.** Triggers only when the line-based architecture causes real harm. Decision material is already documented: 2 known limits (block-in-condition statement splitting; comment ordinals within one item), both pointing to syn-based statement handling
- **Reverse direction (Rust → Tatamu) is production-shaped**: existing Rust projects can be migrated file-by-file with a machine-checked equivalence gate (see below)

## Verification on well-known crates

The round-trip **Rust → Tatamu → Rust** was measured on 18 real crates (~7,900 files, ~3.4M lines) with the strictest available criterion: normalized-AST equivalence **including visibility** (pub/priv round-trip is machine-verified). Throughput 40–80k lines/s.

| Crate | Files equivalent | Crate | Files equivalent |
|---|---|---|---|
| ripgrep | 86/86 | cargo | 335/335 |
| serde | 54/54 | wasmtime | 1529/1529 |
| clap | 119/119 | servo | 1461/1461 |
| tokio | 348/348 | polars | 1926/1927 ¹ |
| regex | 175/175 | rust-analyzer | 868/869 ² |
| syn | 78/78 | diesel | 396/396 |
| bat | 45/45 | bevy | 1209/1209 |
| tracing | 105/105 | rayon | 164/164 |
| itertools | 52/52 | rand | 29/29 |

¹ One file uses `&& { … }` block-in-condition (linted by clippy); recorded as a Stage 3 trigger.
² `minicore.rs` uses nightly-only macros 2.0 / `builtin #` syntax that syn itself cannot parse (input-side limit).

Zero panics, zero silent corruption: every non-equivalent file fails **detectably**. Full history: [docs/31](docs/31-crate-coverage.md), [docs/32](docs/32-extreme-coverage.md).

## Layout

| Path | Contents |
|---|---|
| `transpiler/` | tatamuc (expand / diagnostics / project generation / bindings), test corpora |
| `dogfood/` | Real projects written in Tatamu: rust2ttm (the syn-based converter itself), ttmstat (token-stats CLI), mdlite (Markdown→HTML: CLI / wasm browser demo / Flutter iOS+Android) |
| `docs/` | Language spec + complete experiment log (00–33, chronological) |
| `experiments/` | Token measurements, LLM generation runs, FFI/wasm, crate coverage harness |

---

# Tatamu(畳む) — 日本語

AI(LLM)がコードを書くことを第一に設計された、Rust への 1:1 トランスパイル言語の PoC。想定ユースケースは「Rust で大規模開発をするチームが、人間の書きやすさを捨ててでも AI の開発効率を最大化したい場面」。

- **畳む**: Rust より明らかに少ないトークン — 実測 手書き idiomatic Rust 比 **−42.2%**、LLM 生成 Rust 比 27〜45%
- **広げる**: `tatamuc` が通常の Rust / cargo プロジェクトに機械展開(意味論は Rust と完全に同一)
- **AI 開発効率 ≧ Rust**: 圧縮は機械的に復元可能な省略に限定し、LLM の Rust 知識がそのまま転移(実測: 4 Claude モデルでコンパイル 24/24 = 素の Rust と同率、規則違反ゼロ)

## 利用方法(Usage)

### LLM に Tatamu を書かせる

エディタプラグインやレジストリはありません。想定ワークフローは、次の2ファイルを LLM のコンテキスト/システムプロンプトへ**手作業でコピー**することです:

1. **ルールファイル(few-shot 付き圧縮仕様)**: [`experiments/llm-generation/prompt-tatamu.md`](experiments/llm-generation/prompt-tatamu.md) — これだけでフロンティアモデルは正しい Tatamu を書けます
2. **言語仕様(Rust 差異対照表つき統合版)**: [`docs/tatamu-spec.md`](docs/tatamu-spec.md) — 正式リファレンス

生成された `.ttm` に対して下記ツールを使います。

### ツール一覧

| ツール | 用途 |
|---|---|
| `transpiler/tatamuc.mjs` | トランスパイラ本体。展開(デフォルト)/ `--check`(修正提案付き JSON 診断)/ `--compile`(rustc/cargo 型検査、エラーを `.ttm` 座標へ逆マップ)/ `--project`(cargo プロジェクト生成: `.rs` + C ヘッダ + JS/TS/Dart バインディング)/ `--header` / `--jsbind` / `--dts` / `--dartbind` / `--docs`(サイドカーの doc・コメントを Rust に再結合)/ `--doc-check` / `--doc-sync`(サイドカー鮮度管理) |
| `dogfood/rust2ttm/` | **Rust → Tatamu 変換器**(Tatamu 自身で書かれた syn ベース実装)。`convert`(Rust ディレクトリ → `.ttm` + doc/コメントサイドカー)/ `compare`(2つの Rust の正規化 AST 同値検証) |
| `dogfood/rust2ttm/verify-roundtrip.sh` | ワンコマンドの往復ゲート(Rust → Tatamu → Rust の全ファイル AST 同値検証) |
| `experiments/rust2ttm-coverage/measure.mjs` | クレート全量の往復測定(ファイル単位で 変換→展開→比較) |
| `experiments/rust2ttm-coverage/diag.mjs` | 単一ファイルの往復診断(rustc によるエラー位置特定付き) |
| `transpiler/unit-tests.mjs` | ユニットコーパス(158 ケース。全バグ修正に最小再現を追加する運用) |
| `transpiler/test.mjs` | サニティコーパス(29 プログラム) |
| `transpiler/compile-test.mjs` | rustc 型検査コーパス(要 Rust) |

```sh
node transpiler/tatamuc.mjs file.ttm             # Rust に展開
node transpiler/tatamuc.mjs --check file.ttm     # 構文診断(LLM 向け修正提案付き JSON)
node transpiler/tatamuc.mjs --compile <file|dir> # 型検査 → エラーを .ttm 座標に逆マップ
node transpiler/tatamuc.mjs --project src out    # cargo プロジェクト + FFI バインディング生成
```

## 現在の Stage と今後

段階計画([docs/00](docs/00-concept.md)): 方言 → 独自意味論 → 独自処理系 → エコシステム。

- **Stage 1(Rust トークン節約方言): ゲートクリア済み。** トークン削減 30% 以上を実測(27〜45%、手書き Rust 比 −42.2%)、LLM コンパイル成功 24/24 = 素の Rust と同率
- **Stage 2(AI 向け機能): 実装完了、ゲート検証はこれから。** 構造化診断・プロジェクト生成・帯域外 doc/コメント台帳(AST パスアンカー)・C/JS/TS/Dart FFI・wasm/モバイルターゲットは全て実装・検証済み。ゲート条件 —「生成成功率や修正ループ回数の**改善**」の実測 — が未検証で、これが次のマイルストーン
- **Stage 3(独自処理系): 意図的に未着手。** 行ベース設計が実害を生んだ時点で着手する条件付き。判断材料は文書化済み: 既知の限界2件(条件位置ブロック式の文分割、アイテム内コメント序数)がいずれも「文分割の syn 化」を指している
- **逆方向(Rust → Tatamu)は実運用形**: 既存 Rust プロジェクトを、機械検証付きの同値ゲートのもとでファイル単位に移行できる(下記)

## 既存著名クレートに対する検証結果

**Rust → Tatamu → Rust** の往復を、実在の18クレート(約7,900ファイル・約340万行)で、最も厳しい基準 — **可視性込み**の正規化 AST 同値(pub/priv の往復も機械検証)— で測定した。スループット 40〜80k 行/秒。

| クレート | 同値 | クレート | 同値 |
|---|---|---|---|
| ripgrep | 86/86 | cargo | 335/335 |
| serde | 54/54 | wasmtime | 1529/1529 |
| clap | 119/119 | servo | 1461/1461 |
| tokio | 348/348 | polars | 1926/1927 ¹ |
| regex | 175/175 | rust-analyzer | 868/869 ² |
| syn | 78/78 | diesel | 396/396 |
| bat | 45/45 | bevy | 1209/1209 |
| tracing | 105/105 | rayon | 164/164 |
| itertools | 52/52 | rand | 29/29 |

¹ 条件位置ブロック式 `&& { … }`(clippy が警告する稀構文)を含む1ファイル。Stage 3 移行の判断材料として記録。
² `minicore.rs` は nightly 限定の macros 2.0 / `builtin #` 構文を含み、syn 自体がパース不可(入力側の限界)。

パニック・静かな破壊はゼロ — 同値でないファイルはすべて**検出可能な形で**失敗する。全経緯: [docs/31](docs/31-crate-coverage.md)、[docs/32](docs/32-extreme-coverage.md)。

## 構成

| パス | 内容 |
|---|---|
| `transpiler/` | tatamuc(展開・診断・プロジェクト生成・バインディング)、テストコーパス |
| `dogfood/` | Tatamu 自身で書いた実プロジェクト: rust2ttm(syn ベース変換器そのもの)、ttmstat(トークン統計 CLI)、mdlite(Markdown→HTML。CLI / wasm ブラウザデモ / Flutter iOS・Android 実機動作) |
| `docs/` | 言語仕様と全実験記録(00〜33、時系列) |
| `experiments/` | トークン実測、LLM 生成実験、FFI/wasm、クレート網羅測定ハーネス |
