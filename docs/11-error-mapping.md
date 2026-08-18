# Stage 2-6: rustc エラーの Tatamu 行番号マッピング 実装レポート

> 2026-08-17 実施。`tatamuc --compile <file.ttm>` として実装。

## 背景

07 の診断は Tatamu 構文層のみを対象とし、型エラー等は rustc に委ねていた。しかし rustc のエラーは生成された `.rs` の行番号を指すため、LLM が `.ttm` を修正するにはズレを自力で解釈する必要があった(修正ループの精度を落とす要因)。

## 実装

### transpileMapped: 行番号対応表つきトランスパイル

`transpile` を `transpileMapped(src) → {rust, map}` にリファクタリング。`map[i]` = 出力 Rust の i 行目に対応する `.ttm` の行番号(1始まり、use 注入などの生成行は null)。追跡箇所:

- 空行除去(入力行番号を保持したままフィルタ)
- struct / const の 1行 → 複数行展開(展開後の全行が元の1行を指す)
- use 自動注入(null)、インデント付与(1:1)

### --compile: 型検査+逆マッピング

```
tatamuc --compile file.ttm
  → transpile → rustc --emit=metadata --error-format=json
  → 各診断の primary span の行番号を map で .ttm 行に変換
  → {level, code, line(.ttm), found(.ttm の該当行), message, help} の JSON で出力
```

07 の `--check`(構文層)と同じ出力形式に揃えており、LLM 修正ループは2段のチェックを同じインターフェースで消費できる。

## 検証

struct 展開で行ズレが生じる入力(1行 struct + 型エラー2箇所)に対し:

```json
{"level": "error", "code": "E0308", "line": 3,
 "found": "c := Config {port: \"8080\", host: 42}", "message": "mismatched types"}
{"level": "error", "code": "E0308", "line": 4,
 "found": "n: u32 := \"abc\"", "message": "mismatched types"}
```

— rustc が報告する `.rs` の行(struct 展開で+3行ズレ)が、正しく `.ttm` の 3・4 行目に引き戻され、該当 Tatamu 行のテキストが `found` に入る。rustc の help メッセージ(`try using a conversion method` 等)も透過。既存29本の回帰に影響なし。

## 想定ワークフロー(更新)

```
LLM 生成 → --check(構文層、07)→ --compile(型層、本実装)→ 全エラーが .ttm 行番号で返る → LLM 修正
```

## 残課題

- `--project`(複数ファイル)対応 — 現状は単一ファイルのみ
- span の列番号・複数 span(secondary)の透過
- rustc の `rendered` テキスト内の行番号は未変換(構造化フィールドのみ変換)
