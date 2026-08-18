# syn ベース rust2ttm 実装レポート(ドッグフーディング第3弾)

> 2026-08-18 実施。ソース: `dogfood/rust2ttm/src-ttm/`(**Tatamu で書かれた 619 行の Rust CLI**)。往復ゲート: `dogfood/rust2ttm/verify-roundtrip.sh`

## 到達点(先に)

**idiomatic Rust → rust2ttm → Tatamu → tatamuc → Rust の往復が、AST レベルで機械的に同値証明されるようになった。**

```
$ ./verify-roundtrip.sh <rust-src-dir>
EQUIVALENT: 16 items (block.rs == regen/block.rs)
…
ROUND-TRIP OK: all files AST-equivalent
```

mdlite-rust(393行・doc/コメント/mod tests/rustfmt 折り返し込み)で全4ファイル EQUIVALENT、cargo test 17/17、コメント台帳6件完全再現(序数込み)。docs/26 の残課題「syn ベース化と往復同値 CI」を同時に解消した。

## アーキテクチャ

**ハイブリッド**: syn(Rust 公式パーサ)= 構造の真実、prettyplease = 正準テキスト、実証済みテキスト変換規則 = Tatamu 形。

| 層 | 担当 |
|---|---|
| syn | 項目境界・**可視性**・derive/doc 属性・`#[cfg(test)] mod` 検出・use ツリー・mod 宣言除去 |
| prettyplease | 属性/可視性を除去した項目の正準 Rust 印字(任意フォーマット入力を吸収) |
| textual 層(移植) | 折り返し結合・`let`→`:=`・シグネチャ・const・sibling 修飾除去・**末尾カンマ除去** |
| comments 層(移植) | 行内コメント → 台帳(所属項目・序数付きアンカー) |
| compare | **AST 同値検証**(下記の正規化つき) |

### 行ベース版に対する新能力

1. **`priv` の自動付与** — 可視性が AST から正確に取れるため、非 pub の fn/struct/フィールドすべてに `priv` が付く(mdlite で 30 箇所超を正しく検出)。行ベース版は全公開に潰していた
2. **compare サブコマンド** — 両 .rs を正規化 AST で比較。正規化 = doc 除去・可視性統一・use 除去・test-mod 平坦化・sibling 修飾同一視・**ブロック末尾式の `;` 統一**(両側コンパイル済みなら意味等価)。syn の PartialEq は span を無視するため、フォーマット差は自動的に消える
3. 任意フォーマットの入力(rustfmt 前提が不要に)

## ドッグフーディングとしての成果

Tatamu で syn/prettyplease/regex を使う本格 CLI(619行)が書けた。開発ループはすべて `.ttm` 座標系の `--check`/`--compile` で回り、**今回も tatamuc 本体のバグを3件発見・修正**:

| # | 穴 | 修正 |
|---|---|---|
| 1 | 注釈付き束縛の型に `::` が含まれると変換されない(`kept: Vec<syn::Item> := …`) | 型部の正規表現を `::` 許容に |
| 2 | fn 末尾の複数行 if-else で **`} else {` がブロック文脈を継承しない** | 「閉じて開く行は閉じた文脈を継承」規則を追加 |
| 3 | **閉じ+後続テキスト行**(`}).to_string()`)が fn 末尾でも `;` を貰う | 値文脈 tail の例外を追加 |

ユニットコーパスに3ケース追加(90/90)。また rust2ttm 側では、prettyplease が折り返し時に挿入する**末尾カンマ**が join で `format!("…",)` として残り AST 不一致になる問題を発見し、文字列保護付きの除去を実装 — compare が無ければ気づけない種類の欠陥で、**同値ゲートが変換器自身の品質を引き上げる**構図が早速機能した。

## 計測

- 変換出力: 2,497 トークン(行ベース版 2,464 とほぼ同等、−30.5% vs 元 Rust 3,593)+ サイドカー 778(doc+台帳、オンデマンド)
- ツール自身: Tatamu 619 行

## 残課題

- prettyplease 折り返しの他パターン(連鎖 `.` 以外の分割)での join 網羅性 — compare ゲートがあるので回帰は即検出できる
- コメントアンカーの AST パス化(現在は shadow 変換の行テキスト+序数 — docs/29 の既知の限界)
- 大規模実コードベース(数万行級 crate)でのスループット・網羅率測定
- `#priv` 情報を使った compare(現在は可視性を落として比較 — priv 往復の同値も本来は検証可能)
