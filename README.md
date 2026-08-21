# Tatamu (畳む)

*English / [日本語](#tatamu畳む--日本語)*

**Reversible comment/doc externalization for Rust, with on-demand retrieval — cut an AI agent's context tokens by 50–60% without losing a single byte.**

`tatamu` folds (畳む) the comments and docs out of Rust sources into an anchored sidecar ledger, and unfolds them back byte-exactly. The code itself is never reformatted — not one character. An agent holds the cheap stripped code in context and fetches one item's "why" only when it needs it.

```sh
tatamu strip src/ stripped/        # externalize comments/docs (code untouched, AST self-checked)
tatamu owners stripped/            # list every item with file:line-range
tatamu notes stripped/ MyType::run # fetch just one item's docs & comments
tatamu restore stripped/ back/     # byte-exact restoration
tatamu roundtrip src/ work/        # the gate: strip∘restore∘strip fixpoint + byte equality
```

## Why

Well-documented Rust is expensive to hold in an AI context: in `once_cell`, comments and docs are **56% of the tokens** (measured with Claude's tokenizer); in `regex-automata`, **62% of the bytes**. But deleting them loses the "why" that exists nowhere else. `tatamu` makes that trade-off unnecessary: externalization is fully reversible, and the sidecar stays queryable.

Measured on full crates (bytes):

| crate | reduction |
|---|---|
| regex-automata | **−62%** |
| once_cell | −56% |
| memchr | −48% |
| serde_core | −36% |
| serde_derive (macro-heavy) | −10% |

Reduction tracks comment density — the value is largest on doc-culture crates, zero on uncommented code.

## Guarantees

- **Byte-exact restoration**, verified on 10 corpora / 231 files (once_cell, serde, serde_core, serde_derive, regex, regex-syntax, regex-automata, memchr, tatamu itself, a synthetic protocol crate): **231/231**, zero known inexactness classes ([docs/43](docs/43-blockdoc-ci.md))
- Semantic safety by construction: code lines are copied, never reformatted; every stripped file passes a doc-attr-stripped AST equality self-check
- SAFETY comments (with continuation lines), plain `/* */` block comments, and file preambles stay inline; `/*!` and `/** */` doc forms are preserved via ledger markers
- The whole pipeline is gated in CI: fixture roundtrips packing every hardened failure class (cfg twins, multi-line attributes, rustfmt-wrapped where clauses, macro docs, alignment padding, …), a self-roundtrip, and lens checks

## What the experiments showed

Four controlled experiments (Haiku 4.5 + Sonnet 5; blind / lens / full-comment conditions) mapped exactly what externalization costs and what retrieval recovers:

| knowledge class | where it lives | effect of stripping | evidence |
|---|---|---|---|
| facts with a code trace (constants, structure, algorithms) | code | none — even blind models answer correctly | [docs/39](docs/39-lens-fresh.md), [40](docs/40-lens-blind.md) |
| contracts carried by implementation patterns (orderings, state machines, cleanup) | adjacent code | none — models imitate correctly; 18/18 modification runs, zero violations | [docs/41](docs/41-safety-mods.md) |
| design rationale ("why we don't…") | comments only | lost blind; recovered via `notes` | [docs/40](docs/40-lens-blind.md) |
| specs with no implementation yet (protocols, conventions) | comments only | blind collapses to 11–22% (confidently wrong code); **lens recovers 100%, equal to full** | [docs/42](docs/42-novel-design.md) |

Highlights:

- **Retrieval discrimination is near-ideal**: models fetch notes on doc-only questions and never on code-derivable ones (0/8 wasted fetches)
- **Lens beat full-comment context at the frontier** (Sonnet 11/12 vs 10/12) — explicit retrieval focuses better than passive presence, at 20–32% lower cost
- **Stripping decides what fits at all**: commented memchr overflows a 200k context under an agent harness (~205k tokens); stripped fits at ~80k
- **Small models need one sentence**: with "fetch first unless obvious" in the prompt, Haiku matches Sonnet; with "use if needed", its fetch judgment collapses in large contexts

## Usage

```sh
cargo build --release --manifest-path tool/Cargo.toml
# binary at tool/target/release/tatamu
```

Recommended agent-prompt wording when handing over stripped code (this exact framing is what the experiments validated):

> The codebase has its comments and docs externalized into sidecar ledgers. The code is byte-identical to the original otherwise. `./owners` lists items; `./notes <name>` prints one item's docs and comments (suffix match; use a file stem for module docs). **Before writing any code, consult `./notes` for the items you are about to modify or imitate** — skip fetching only when the answer is plainly visible in the code.

Ledger format (`<file>.doc.md`): `## owner` sections with doc bodies and `~ above|tail|float \`anchor\`#n: text` entries; physical-line anchors with scope-qualified owners (`once_box::OnceBox::get_or_try_init`), `#n` shadows for cfg twins, indent/alignment deltas (`above+4`, `tail+1`), and form markers (`~ form: block|inline`). See [docs/36](docs/36-strip-pivot.md) and [docs/38](docs/38-subdir-hardening.md).

## Project history — this began as a language

**The entire five days — every measurement, failure, and decision, day by day (2026-08-17 to 08-21), with links into all the original reports — is recorded in [docs/46: the chronological record](docs/46-timeline.md).** What follows here is the short version.

Tatamu started (2026-08-17) as an **AI-first Rust dialect**: a 1:1 transpiled shorthand trading human writability for LLM token efficiency. That phase built a full toolchain — transpiler with structured diagnostics and cargo/FFI/wasm/mobile targets, and a syn-based reverse converter verified **AST-equivalent on 18 crates / ~3.4M lines** — and then measured its own gate: *"AI development efficiency ≥ raw Rust, plus clearly fewer tokens."*

The gate was **not met** on either axis (frontier models tie raw Rust exactly), and the decisive ablation showed the headline compression was never the dialect's: comment externalization alone gives −56%, the dialect only −11 pp more ([docs/35](docs/35-stage2-context.md)). So the dialect was folded, and its comment-ledger machinery became this tool ([docs/36](docs/36-strip-pivot.md)–[37](docs/37-fold-dogfood.md)).

- **Full arc summary (gate → pivot → validation)**: [docs/44](docs/44-pivot-summary.md)
- **Whole-project overview**: [docs/45](docs/45-project-overview.md) · **Chronological record with all links**: [docs/46](docs/46-timeline.md)
- Legacy assets remain functional: `transpiler/` (tatamuc, 163-case unit corpus in CI), `dogfood/rust2ttm/` (frozen `.ttm` sources), [docs/tatamu-spec.md](docs/tatamu-spec.md) (dialect spec v0.5)

## Repository layout

| path | role |
|---|---|
| `tool/` | **canonical**: the `tatamu` binary (strip/restore/roundtrip/owners/show/notes) + integration tests |
| `docs/00–46` | complete chronological record: every measurement, decision and pivot |
| `experiments/` | reproducible experiment harnesses (gate measurements, lens/blind/safety/novel-design) |
| `transpiler/`, `dogfood/` | legacy dialect toolchain (kept green in CI) |
| `.github/workflows/ci.yml` | roundtrip gate + unit corpora on every push/PR |

License: [MIT](LICENSE).

---

# Tatamu(畳む) — 日本語

**Rust ソースのコメント・doc を完全可逆に外部化し、AI が必要な時だけ引き戻す — 文脈トークンを 50〜60% 削減、失うバイトはゼロ。**

`tatamu` はコメント・doc をアンカー付きサイドカー台帳へ「畳み」、バイト完全一致で「広げ」ます。コードは1文字も再整形しません。エージェントは軽くなったコードを文脈に常駐させ、「なぜ」が必要になった項目だけを従量取得します。

```sh
tatamu strip src/ stripped/        # コメント・doc を外部化(コード無変更、AST 自己検査)
tatamu owners stripped/            # 全アイテムを file:行範囲 付きで列挙
tatamu notes stripped/ MyType::run # 1項目の doc・コメントだけ取得
tatamu restore stripped/ back/     # バイト完全一致で復元
tatamu roundtrip src/ work/        # ゲート: strip∘restore∘strip 不動点+バイト一致
```

## なぜ

よく文書化された Rust は AI 文脈で高くつきます — once_cell はトークンの **56%**(Claude トークナイザ実測)、regex-automata はバイトの **62%** がコメント・doc。しかし消せば、コードのどこにも痕跡が無い「なぜ」を失う。`tatamu` はこのトレードオフを解消します: 外部化は完全可逆で、サイドカーはいつでも照会できます。

フルクレート実測(バイト): regex-automata **−62%** / once_cell −56% / memchr −48% / serde_core −36% / serde_derive −10%。削減率はコメント密度に比例します(doc 文化のあるクレートで最大、コメントの無いコードではゼロ)。

## 保証

- **バイト完全一致の復元**: 10コーパス・231ファイル(once_cell / serde 系 / regex 系 / memchr / 自分自身 / 合成クレート)で **231/231、既知の非一致クラスゼロ**([docs/43](docs/43-blockdoc-ci.md))
- 構成による意味安全: コード行はコピーのみで再整形しない+doc 除去 AST 同値の自己検査
- SAFETY コメント(継続行込み)・素の `/* */`・ファイル前書きは inline 温存。`/*!`・`/** */` の形式は台帳マーカーで保存
- パイプライン全体を CI でゲート化(故障クラス全部入りフィクスチャ+自己 roundtrip+lens 検査)

## 実験が示したこと

対照実験4本(Haiku 4.5+Sonnet 5 × blind/lens/full)で「外部化が何を失わせ、従量参照が何を回収するか」を知識クラス別に確定しました:

| 知識のクラス | 所在 | strip の影響 | 根拠 |
|---|---|---|---|
| コードに痕跡のある事実 | コード | 無害(blind でも正答) | [docs/39](docs/39-lens-fresh.md)・[40](docs/40-lens-blind.md) |
| 実装パターンに刻まれた契約(ordering・状態機械・解放) | 隣接コード | 無害(模倣で正しく書ける。改修18ラン違反ゼロ) | [docs/41](docs/41-safety-mods.md) |
| 設計判断の why(やらない理由) | コメントのみ | blind で喪失 → `notes` で回収 | [docs/40](docs/40-lens-blind.md) |
| 実装が存在しない仕様 | コメントのみ | **blind は 11〜22% に崩壊(確信を持って非互換実装)、lens は 100% で full と同点** | [docs/42](docs/42-novel-design.md) |

ハイライト: 参照の選別はほぼ理想(コードで分かる問いへの無駄引き 0/8)/**フロンティアでは lens がコメント常駐 full を上回る**(Sonnet 11/12 vs 10/12、コスト −20〜32%)/コメント込み memchr はハーネス込みで 200k 文脈に入らないが stripped なら 80k — **圧縮が fits/doesn't-fit を決める**/小モデルは案内文を「必要なら使え」→**「まず引け(自明な時だけ省略可)」**にするだけで Sonnet 同点。

## 使い方

```sh
cargo build --release --manifest-path tool/Cargo.toml
```

stripped コードをエージェントに渡す際の推奨文言(実験で検証済みの言い回し):

> このコードベースはコメント・doc がサイドカー台帳に外部化されている(それ以外はバイト同一)。`./owners` で一覧、`./notes <名前>` で1項目の doc・コメントを取得(接尾一致、モジュール doc はファイル stem)。**コードを書く前に、変更・模倣する項目の `./notes` を必ず引くこと** — コードから自明な場合のみ省略してよい。

台帳フォーマットの詳細は [docs/36](docs/36-strip-pivot.md)・[docs/38](docs/38-subdir-hardening.md)。

## 経緯 — このプロジェクトは言語として始まった

**この五日間(2026-08-17〜08-21)に起きたことは、測定も、失敗も、判断も、日次の時系列記録 [docs/46](docs/46-timeline.md) に、元レポート全部へのリンク付きで残してある。** 以下はその短縮版である。

Tatamu は 2026-08-17 に **AI-first な Rust 方言**(人間の書きやすさを捨てて LLM のトークン効率を取る 1:1 変換言語)として始まり、トランスパイラ・構造化診断・cargo/FFI/wasm/モバイル出力・**18クレート約340万行で AST 同値 100%** の逆変換器まで作った上で、自ら定義したゲート「AI にとって Rust と同等以上+明確なトークン削減」を実測しました。

結果は **2軸とも未達**(フロンティアモデルは素の Rust と完全同点)。決定打はアブレーションで、圧縮の主役は方言ではなくコメント外部化(−56% vs 方言 −11%)と判明([docs/35](docs/35-stage2-context.md))。方言は畳まれ、そのコメント台帳機構が本ツールになりました([docs/36](docs/36-strip-pivot.md)〜[37](docs/37-fold-dogfood.md))。

- **転回篇の総括**: [docs/44](docs/44-pivot-summary.md) / **全体統括**: [docs/45](docs/45-project-overview.md) / **時系列(全リンク付き)**: [docs/46](docs/46-timeline.md)
- legacy 資産は現役のまま保存: `transpiler/`(tatamuc、unit 163 ケースを CI 維持)、`dogfood/rust2ttm/`(.ttm 正準ソース凍結)、[docs/tatamu-spec.md](docs/tatamu-spec.md)(方言仕様 v0.5)

## 構成

| パス | 役割 |
|---|---|
| `tool/` | **正準**: `tatamu` バイナリ(strip/restore/roundtrip/owners/show/notes)+統合テスト |
| `docs/00〜46` | 全測定・全判断・全転換の時系列記録 |
| `experiments/` | 再現可能な実験ハーネス群 |
| `transpiler/`・`dogfood/` | legacy 方言ツールチェーン(CI で green 維持) |
| `.github/workflows/ci.yml` | push/PR ごとの roundtrip ゲート+ユニットコーパス |

ライセンス: [MIT](LICENSE)。
