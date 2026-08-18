# Stage 2-13: doc 鮮度管理 実装レポート

> 2026-08-18 実施。`tatamuc --doc-check` / `--doc-sync` として実装。[09-out-of-band-docs.md](09-out-of-band-docs.md) の未決事項 1 に対応。

## 背景

09 のアウトオブバンド化は「ドキュメントを別ファイルに置く」設計だが、別ファイルにした瞬間に**コードとの乖離(ドリフト)**が最大のリスクになる。コード編集が LLM の主活動である以上、ドリフト検出は仕様の一部であるべき。

## 設計: シグネチャ記録によるドリフト検出

サイドカーの各節に、doc 執筆時点の**シグネチャをバッククォート行として記録**する:

```markdown
## parse

`fn parse(text &str) R<Config>`

Parses `key=value` lines into a Config.
```

- この行は鮮度管理のメタデータであり、`--docs` 展開時の `///` 出力には**含めない**
- fn / trait は宣言部のみ、struct / enum は**フィールドを含む全体**をシグネチャとする(struct はフィールドこそが意味的シグネチャのため)

## コマンド

### `--doc-check`(CI・LLM ループ向け、既存の --check / --compile と同形式の JSON)

| rule | severity | 検出 |
|---|---|---|
| doc-orphan | error | コードに存在しない項目の節(削除・リネームの取り残し) |
| doc-stale-signature | warning | 記録シグネチャと現在のコードの不一致。**recorded / current の diff 付き**で「コードは変わったが doc がレビューされていない」を可視化 |
| doc-missing | info | doc 節のないトップレベル項目 |

exit code は error 有無に連動(CI に組み込み可能)。

### `--doc-sync`(機械的に直せる部分の自動修復)

- 既存節の記録シグネチャを現在のコードに更新
- 未ドキュメント項目のスタブ(`## name` + シグネチャ + TODO)を追記
- **孤児節は削除しない**(doc 本文の喪失は破壊的なので、check で報告し人間/LLM の判断に委ねる)

## 検証(ライフサイクル一周)

1. 既存サイドカーに `--doc-sync` → 全節にシグネチャ記録+未ドキュメントの `main` にスタブ追記。タイトル・本文は保持
2. コードを改変(struct をリネーム、fn に引数追加、新規 fn 追加)して `--doc-check`:
   - `Config` 節 → **doc-orphan**(error)
   - `parse` → **doc-stale-signature**(recorded: `fn parse(text &str) R<Config>` / current: `fn parse(text &str, strict bool) R<Settings>`)
   - `Settings` / `validate` → **doc-missing**
3. `--docs` 展開の `///` 出力にシグネチャ行が混入しないこと、既存29本の回帰を確認

## 想定ワークフロー

```
LLM がコード編集 → --doc-check(drift 検出)→ stale の節を LLM がレビュー・更新 → --doc-sync(記録更新)
```

doc-stale-signature が「シグネチャ変更 = doc 再確認が必要」の近似として機能する。本文だけに影響する意味変更(シグネチャ不変)は検出できない — これは既知の限界で、必要なら「本文ハッシュ + コード本体ハッシュの対記録」への拡張余地がある。

## Stage 2 の完了

これで 05 以降に積んだ Stage 2 系の実装項目は全て完了した(docs/06〜18)。言語・ツールチェーンの全体像:

- **仕様 v0.4**: `:=` 束縛 / 注釈 / シグネチャ短縮 / derive 短縮(修飾パス可)/ use 不要 / `R<T>` / ジェネリクス・enum は Rust のまま / `#dep` / `#crate`
- **tatamuc**: 変換・`--check`(構文診断)・`--compile`(型検査+行マッピング、単一/複数ファイル)・`--project`(cargo 生成: .rs + .h + .mjs + .d.mts)・`--header` / `--jsbind` / `--dts`・`--docs`(doc 結合)・`--doc-check` / `--doc-sync`(鮮度管理)
- **実証済み**: LLM 生成(4モデル、易24+難24+外部クレート、全コンパイル)/ C ABI 双方向 / wasm(文字列・ネスト struct・配列・enum)/ crates.io / TypeScript 型安全
