# Stage 2-12: 外部クレート実証レポート

> 2026-08-18 実施。実験: `experiments/extern-crates/`(手書きデモ + LLM 生成デモ)

## 目的

`#dep` 指令(08 で Cargo.toml 生成までは実装済み)が実際の crates.io クレートで機能するかを、エコシステムの中心である **serde / serde_json(derive マクロ込み)** で実証する。

## 追加した仕様・実装(v0.4)

| 追加 | 内容 |
|---|---|
| `#dep name version features=a,b` | features 指定 → `serde = { version = "1", features = ["derive"] }` を生成 |
| 修飾パス derive | `+Debug,serde::Serialize,serde::Deserialize` → `#[derive(Debug, serde::Serialize, serde::Deserialize)]`。**修飾パスにしたことで外部クレートの derive にも `use` 行が不要**(S6 の「use 不要」原則を外部クレートまで一貫) |
| クレート項目はフルパス参照 | `serde_json::to_string_pretty(&x)` — 元々パススルーで動作、仕様に明文化 |

## 実証 1: 手書きデモ

`Item +Debug,Clone,serde::Serialize,serde::Deserialize` の Vec を JSON にシリアライズ → デシリアライズ → 集計。cargo build(crates.io から serde 取得)→ 実行成功(`total = 596.50`)。

**`--compile` のエラーマッピングも外部クレート込みで動作**: 依存キャッシュが温まっていればサンドボックス内オフライン(`CARGO_NET_OFFLINE=true`)で型検査でき、仕込んだ型エラーが `main.ttm` の正しい行にマップされた。

## 実証 2: LLM 生成(本題)

仕様プロンプトに上記の外部クレート規則を**1段落追記しただけ**(例は一切なし)で、Sonnet 5 に「CSV を読んで serde で pretty JSON 出力する」課題を出した結果:

- `#dep serde 1.0 features=derive` / `#dep serde_json 1.0` — 指令構文を正しく使用
- `+Debug,Clone,serde::Serialize,serde::Deserialize` — 修飾 derive を正しく使用
- `serde_json::to_string_pretty(&expenses)?` — フルパス参照+`?` の R\<()\> 連携
- 型注釈(`Vec<Expense>`, `Vec<&str>`, `f64`)も必要箇所のみ

**一発でオフライン型検査 ok → cargo build → 実行成功**(正しい JSON + `count = 4`)。ルールの説明だけで few-shot 例なしに新しい指令を正しく使えたのは、これまでの知見(母体言語の直感に沿った設計は転移する)のさらに強い裏付けになる。

## 意味すること

- 00-concept の懸念「エコシステムをゼロから作る必要」は完全に消えた — **crates.io の全クレートが Tatamu からそのまま使える**(derive マクロ含む)
- `use` 不要の原則が外部クレートまで貫通した(修飾パスの derive という Rust の既存機能に乗っただけで、トランスパイラの新規機構はほぼゼロ)

## 制約

- crates.io へのネットワークはサンドボックス外でのみ可(初回フェッチ時)。キャッシュ後はサンドボックス内オフラインで `--compile` 可能
- trait を持ち込むクレート(例: `rand::Rng` のメソッドを使う場合)は trait の use が必要になるケースがある — 現状はフルパス `rand::Rng::gen(&mut rng)` 形式で回避可能だが、`#use` 指令(明示 use の逃げ道)の追加を検討課題とする
- prelude マップは std のみ。クレート側 prelude の自動化は Stage 3 の検討事項
