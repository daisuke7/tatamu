# Tatamu 紙上文法プロトタイプ 実験レポート

> 2026-08-17 実施。[00-concept.md](00-concept.md) の「検討手順 3: 紙上文法プロトタイプ」に対応。
> 実験コード: `experiments/paper-prototype/`(`rust/*.rs`, `tatamu/*.ttm`, `measure.mjs`、生データは `results.json`)

## 目的

[01-token-analysis.md](01-token-analysis.md) の示唆に基づき Tatamu v0 文法ルールを設計し、同一プログラムを「素の Rust(rustfmt 風)」「ミニファイ Rust(対照群)」「Tatamu」で書き比べてトークン削減率を測る。対照群を挟むことで、**書式由来の削減と文法由来の削減を分離**する。

## Tatamu v0 文法ルール(ドラフト)

各ルールはマイクロ実測(o200k / claude_legacy)で効果を確認してから採用した。

| # | ルール | 例 | 実測効果 |
|---|---|---|---|
| F1 | インデント・空行・コメントなし(ドキュメントはアウトオブバンド) | — | 実コードで最大33%(01実験) |
| F2 | 改行が文区切り。`;` は同一行の連結時のみ | `x := 1` | `;`分 |
| S1 | `let` 廃止、`:=` で束縛(可変は `mut x :=`) | `let x = 5;` → `x := 5` | −2/−2 |
| S2 | シグネチャの `:` と `->` を省略 | `fn add(a: i64) -> i64` → `fn add(a i64) i64` | −3/−3 |
| S3 | `pub` 廃止(ライブラリはデフォルト公開、ファイル指示子で反転) | `pub fn get` → `fn get` | −1〜2 |
| S4 | derive は `+Trait,Trait` 後置 | `#[derive(Debug, Clone)]\nstruct P` → `struct P +Debug,Clone` | −2/−4 |
| S5 | struct フィールドは `name Type` のカンマ区切り1行 | `x: f64,\n y: f64,` → `x f64, y f64` | −4/−4 |
| S6 | `use` 行廃止 — トランスパイラが prelude+プロジェクト索引から自動解決 | `use std::fs;` → (なし) | 行あたり−8前後 |
| S7 | ターボフィッシュ廃止 — 使用箇所からの型推論で挿入 | `.collect::<Vec<_>>()` → `.collect()` | −3/−5 |
| S8 | 複合型のみエイリアス: `R<T>` = `Result<T, Box<dyn Error>>` | −5/−5 | |

**却下したルール**(実測で効果なし/逆効果): 単純な型名短縮 `V<S>`(`Vec<String>` と同コスト)、マクロ改名 `p!`(`println!` と同コスト)、キーワードの記号化(01実験で実証済みの逆効果)。

## 書き比べサンプル(wordcount 抜粋)

素の Rust(221 トークン):
```rust
use std::collections::HashMap;
use std::env;
use std::fs;

fn main() {
    // Read the target file given as the first CLI argument.
    let path = env::args().nth(1).expect("usage: wordcount <file>");
    ...
    let mut items: Vec<(String, u64)> = counts.into_iter().collect();
```

Tatamu(134 トークン、−39.4%):
```
fn main() {
path := env::args().nth(1).expect("usage: wordcount <file>")
...
mut items := counts.into_iter().collect()
```

## 結果

5プログラム(wordcount / config_parse / geometry / stats / todo、計約100行の Rust)の合計:

| 比較 | o200k | claude_legacy |
|---|---:|---:|
| Tatamu vs 素の Rust | **−27.6%** | **−25.3%** |
| Tatamu vs ミニファイ Rust(= 純粋な文法効果) | **−15.9%** | **−19.1%** |

プログラム別(o200k、Tatamu vs 素の Rust): wordcount −39.4%、config_parse −29.4%、geometry −29.1%、todo −22.5%、stats −19.3%。import と型注釈が多いプログラムほど効き、式中心の数値計算(stats)は効きにくい。

### 実コードへの外挿

今回のサンプルはコメントが少なめ(書式由来の削減は13.9%のみ)。01実験の実コードではコメント+書式で33.1%削れるため、実コード比の合算見込みは:

> 書式レイヤ 33.1% × 文法レイヤ 15.9〜19.1% ≒ **合計 44〜46% 削減**

Stage 1 のゲート条件(30%以上)は、コメントの多い実コードを対象とする限り**十分に届く見込み**。ただしコメントを完全にアウトオブバンド化する前提であり、この設計判断(AI の理解に必要な文脈をどこに置くか)が全体の成否を握る。

## 制約・未検証事項

- **LLM 生成成功率は未計測**(ゲート条件のもう半分)。Tatamu ルールを few-shot で与えた LLM が正しい Tatamu を書けるか、素の Rust と比べてエラー率が悪化しないかは、次の実験で API を使って測る必要がある
- Tatamu サンプルは手書きであり、トランスパイラの実在しない機能(使用箇所からの型推論、import 自動解決)を仮定している。特に S7 の使用箇所推論は実装難度が高い
- サンプル5本は小規模。ジェネリクス・ライフタイム・async の重いコードでの検証が未了

## 次のステップ

1. **LLM 生成実験**: Tatamu v0 ルール+few-shot をプロンプトに与え、新規課題を Tatamu で書かせて (a) 文法準拠率 (b) 意味の正しさを素の Rust 生成と比較(API アクセスが必要)
2. ルールの当落を反映した **Tatamu v0.1 仕様メモ**の作成
3. Stage 1 トランスパイラ(Tatamu → Rust)の最小実装 — S7(使用箇所推論)を落として `collect() Vec<_>` のような軽量注釈に置き換える案も検討
