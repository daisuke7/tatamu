# Stage 2-14: データ付き enum / #use 指令 実装レポート(仕様 v0.5)

> 2026-08-18 実施。設計原則の再確認を受けた機能追加: **「AI にとって Rust と同等以上の開発効率」「Rust より明らかに少ないトークン消費」**の両方を満たすことを各機能で計測・検証する。
> サンプル: `experiments/lang-features/`

## 1. データ付き enum(言語面)— struct と規則を統一

enum 宣言に struct と同じ2つの短縮を適用:

```
enum Shape +Debug,Clone {Circle(f64), Rect {w f64, h f64}, Empty}
```

- **`+Derives` 後置**(`#[derive(...)]` 行を排除)
- **struct-variant のフィールドは `name Type`**(コロン省略)
- 単一行・複数行どちらも可。タプル/ユニット variant、**match パターン、その他の enum 構文は Rust のまま**(パターン `Shape::Rect {w, h}` は元々コロンがなく、変更不要 — Rust のパターン構文が既に Tatamu 的だった)

**トークン実測**: 上記 enum 宣言で rustfmt 形式 Rust 31 トークン → Tatamu 23 トークン(**−25.8%**)。derive と宣言が多いコードほど効く。

## 2. データ付き enum(FFI 面)— 3面マーシャリング

`#[repr(C)]` データ enum(RFC 2195: tag + union レイアウト)を C / JS / TS の3面に実装:

| 面 | 生成物 |
|---|---|
| C ヘッダ | `typedef enum {...} OpTag;` + `typedef struct { OpTag tag; union { struct {double factor;} Scale; ... } payload; } Op;` |
| JS | descriptor(size / payloadOffset / tags / variants)+ `readStruct` / `writeStruct` が **`{kind: "Translate", dx: 10, dy: 20}` 形式のタグ付きオブジェクト**で読み書き |
| .d.ts | **判別合併型** `type Op = {kind: "Nop"} \| {kind: "Scale"; factor: number} \| ...` — `if (op.kind === "Scale")` で TS の narrowing がそのまま効く |

検証:
- wasm 実行: Point (3,4) に Translate{10,20} → (13,24)、Scale{2} → (26,48)、Nop → 不変。roundtrip 一致
- レイアウト: Rust const assert(size 24 / align 8)と JS 生成値が一致
- C: union アクセス構文チェック通過
- tsc: narrowing 正例通過、負例3種検出(variant とフィールドの不整合 / 存在しない variant / narrowing 後の誤フィールド)

## 3. `#use` 指令 — 明示 import の逃げ道

`#use std::fmt::Write` → `use std::fmt::Write;` を注入。**トレイトがスコープに必要なケース**(`write!` の `fmt::Write`、`rand::Rng` 等)のための唯一の明示 import 機構で、それ以外は従来どおり自動解決。`use` 行(7トークン)と `#use` 行(7トークン)は同コストであり、これはトークン削減策ではなく**「自動解決では原理的に足りない穴」を塞ぐ完全性のための機能**。

## 4. LLM 検証

仕様プロンプトに3項目を追記し(例は enum 1行のみ)、Sonnet 5 に「データ enum の式インタープリタ + `#use` で `write!` レポート」課題を出した結果 — `Box<Expr>` 入りの再帰 enum、短縮フィールド、match、`#use` を全て正しく使い、**一発コンパイル・実行成功**((2+3)×−4 = −20)。

## 設計原則との整合(まとめ)

| 原則 | 本機能での状況 |
|---|---|
| AI の開発効率 ≧ Rust | enum 短縮は struct と同型の規則なので追加学習コストほぼゼロ(LLM 一発成功)。`#use` は自動解決の穴による**コンパイル不能ケースを解消**する方向の改善 |
| トークン消費 < Rust | enum 宣言 −25.8%。`#use` は中立(ただし従来この穴は「書けない」だったので実質改善) |

## 残課題

- データ enum の explicit discriminant(`Scale = 5 {factor f64}`)は未対応(Rust 側も特殊)
- ジェネリック enum(`Option<T>` 様のユーザー定義)の FFI は対象外のまま(C ABI に乗らないため妥当)
- `#use` の乱用(全 import を #use で書く LLM)への lint は未実装 — 診断ルール候補
