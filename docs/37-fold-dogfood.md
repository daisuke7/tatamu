# 畳みの実行と (a) モード・ドッグフーディング第4弾: 正準ソースの素 Rust 化と `lens`(owners/show/notes)

> 2026-08-19 実施。docs/36 の続き。成果物: `tool/`(正準クレート、バイナリ名 `tatamu`)+ lens モジュール。

## 1. 方言を文字通り畳んだ — 正準ソースの切り替え

rust2ttm の正準ソースを .ttm から**素の Rust**に切り替えた:

- `tool/` = 新しい正準クレート(パッケージ名 **`tatamu`** — 言語名は「コメントを畳む」ツール名として存続)
- 生成 .rs を採用 → rustfmt 適用 → 警告ゼロ化(未使用シンボル削除、内部ヘルパの `pub(crate)`/非公開化、
  Tatamu プレリュード由来の未使用 use を cargo fix で一掃)。2,340行 → 整形後も全ゲート green
- `dogfood/rust2ttm/src-ttm` は凍結(legacy)。以後の開発は tool/ の Rust を直接編集する
- **rustfmt 折返し形式の自分自身に対して roundtrip 7/7 バイト完全一致** — rustfmt スタイルという新しい
  入力クラスでも strip パイプラインは無傷だった

## 2. 実装ドッグフード: `lens` — サイドカー従量参照の実用化

(a) の価値仮説「コメントは必要な時だけ読む」を実際に使える形にする3サブコマンドを、
**素の Rust で(doc・コメントを普通に書きながら)** 新規実装した(`tool/src/lens.rs`、約190行):

- `tatamu owners <dir|file>` — 全アイテムを `file:start-end owner` で列挙(struct フィールドや
  enum variant、ネスト mod 内も strip と同じスコープ解決で)
- `tatamu show <dir|file> <owner> [--notes]` — 1アイテムのソースだけを行範囲付きで出力
  (直上の属性・doc・コメント込み、`--notes` でサイドカー節を後置)
- `tatamu notes <dir|file> <owner>` — サイドカー節(doc+台帳エントリ)だけを出力

owner 照合は完全一致+`::` 接尾照合(`get_or_try_init` で `once_box::OnceBox::get_or_try_init` が引ける)。
スパン解決は strip/restore と同一の結合・スコープ機構を使うため、台帳アンカーと同じ座標系を持つ。

エージェントの想定ワークフロー: **stripped コードを文脈に常駐(−53%)→ 「なぜ」が必要になった項目だけ
`notes`/`show --notes` で取得**。全ファイル再読み込みが不要になり、外部化の「従量制」が現実の操作になった。

実装中に実バグ1件を自分で踏んで修正: rustfmt の where 折返しシグネチャ(`{` が次行)で `show` が
本体を含まない → 次論理行が `{` で始まる場合の前方走査を追加。

## 3. 検証

- 全コーパス回帰(once_cell / serde / memchr / regex / 自分自身 = 26ファイル):
  不動点 26/26、バイト完全一致 23/26(非一致3件は既知の `/*!`→`//!` 形式正規化のみ)
- transpiler ユニット 163/163 維持(tatamuc は無変更)
- 警告ゼロ・rustfmt クリーンでビルド

## 4. ドッグフード観察 — docs/35 の懸念3点に対する今日のデータ

1. **SAFETY 可視性**: 本コードベースに unsafe が無く実戦では未検証(機構は once_cell/imp_std で検証済み)
2. **実効圧縮率はコメント密度に比例する**: 自分自身の strip は **−1%**(Tatamu 出自のコードには
   コメントが無い)。once_cell −56% ↔ 自己 −1% が両極。**(a) の価値は「doc 文化のある既存 Rust 資産」で
   最大、コメントを書かないコードではゼロ** — 適用対象の選別が製品上の論点になる
3. **サイドカー参照頻度**: 本セッションは全コードが文脈内にあったため計測不能。lens により
   「新しい文脈で stripped だけ渡して開発する」次回セッションで初めて実測できる(次回への引き継ぎ)

## 5. 使い方(正準)

```
cargo build --release --manifest-path tool/Cargo.toml
tatamu strip src/ stripped/        # コード無再整形+AST 自己検査
tatamu owners stripped/            # アイテム一覧
tatamu notes stripped/ MyType::run # 1項目の why だけ取得
tatamu restore stripped/ back/     # 完全復元(once_cell 等でバイト一致)
tatamu roundtrip src/ work/        # 往復ゲート
```

legacy: `convert` / `compare`(.ttm 方言系)は当面残置。
