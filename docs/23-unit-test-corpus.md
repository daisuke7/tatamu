# tatamuc ユニットテストコーパス整備 レポート

> 2026-08-18 実施。`transpiler/unit-tests.mjs`(70ケース、rustc 不要・即時実行)

## 背景

第2回ドッグフーディング(21)で `--check` に「文字列リテラル内のキーワードに誤検知する」盲点が見つかった。診断・変換の既知バグを**最小ケースとして固定化**し、今後の変更で退行しない体制を作る。

## 構成(3系統・70ケース)

### 1. 診断コーパス(--check、25ケース)

- **正例**: 全10ルールが正しい行番号で発火すること
- **負例(誤検知ガード)**: 発火してはいけない意地悪入力 — 文字列内の `let x = 1;` / `use` / `->` / `pub`、`if let` / `while let` / `else if let`、`let` を含む識別子(`completed`, `outlet`)、`#use` 指令、char リテラル `'"'` が潰しを壊さないこと、など
- 過去の実バグ2件(mdlite の文字列内 let、Opus の `mut x =`)はどちらも専用ケース化

### 2. doc 鮮度コーパス(--doc-check、5ケース)

orphan / stale-signature / missing / 一致時は無音 / struct フィールド変更で stale、を固定。

### 3. 変換コーパス(40ケース)

transpile 出力への contains / excludes / counts アサーション。**歴史上のセミコロン挿入バグ全種を1ケースずつ**含む(for ブロック文・値 fn 末尾・インライン let-if・複数行 let-match の `};`・複数行 `vec![` の `];`・クロージャ呼び出しの `});`・unsafe 末尾・match 末尾・値/文 match アーム)ほか、束縛4形・シグネチャ(ジェネリクス / ライフタイム / mut / extern)・struct / enum 短縮・R\<T\>・prelude / #use 注入・ターボフィッシュ透過・文字列保護など。

## 整備の過程で発見・修正した実バグ2件

コーパスを書くために意地悪入力を探る過程そのものが監査になり、新たな穴が2つ見つかった:

| # | 穴 | 修正 |
|---|---|---|
| 1 | **raw string 内の `"` で文字列保護が破れる** — `r#"He said "hi" := x"#` の `:= x` 部分が変換されてしまう(outsideStrings が raw string 非対応) | outsideStrings に `r#*"…"#*` の走査を追加(変換・診断・セミコロン判定すべてに効く) |
| 2 | **`--check` にコメント検出がない** — F1 は「コメントなし」の仕様なのに `//` / `/*` を見逃していた | `no-comments`(warning)を追加。サイドカー `.doc.md` への誘導を suggestion に。URL(`"https://…"`)は文字列内なので発火しないことをケースで保証 |

## 検証

- ユニット 70/70、コーパスサニティ 29/29
- 実物の全 `.ttm` 29ファイル(dogfood + experiments)に新診断の誤爆ゼロ
- 生成コーパス 48本のコンパイル回帰なし

## 運用

```
node transpiler/unit-tests.mjs   # 数百 ms。変更のたびに実行する一次ゲート
node transpiler/test.mjs         # コーパスサニティ(29本)
node transpiler/compile-test.mjs …  # rustc 型検査(重い・二次ゲート)
```

新しい摩擦・バグは「修正と同時に unit-tests.mjs へ最小ケースを追加」を必須の作法とする(本レポートの2件で実践済み)。
