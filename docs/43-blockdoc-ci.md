# `/** */` 形式保存と前書きコメントの根治、そして roundtrip の CI ゲート化 — 既知の非一致ゼロへ

> 2026-08-21 実施。docs/38 の残課題2件(`/**` ブロック形式・pool.rs 型の前書きレイアウト)の解消と、
> tool/ の統合テスト+GitHub Actions CI。

## 1. `/** ... */`(アイテム doc のブロック形式)のバイト一致保存

`/*!` の `~ form: block` マーカー方式を節単位に拡張した:

- SLine / Section に **doc 形式の3値**(0=`///` 行形式、1=複数行 `/** */`、2=一行 `/** x */`)を追加
- クリーンな standalone ブロック(`/**` 単独行 … `*/` 単独行)は**内側の行を verbatim 捕捉**し、
  サイドカー節の先頭に `~ form: block` を記録。一行形式は `~ form: inline`
- restore はマーカーに従い元の形で再構成。`///` 行との混在などクリーンでないケースは
  従来どおり行形式へフォールバック(fixpoint は常に維持)

## 2. 前書きコメント問題の根治(pool.rs 型、docs/38 の唯一の既知非一致)

「`//` 前書き → 空行 → `/*!` intro」レイアウトは台帳座標で復元順序が壊れる
(fixpoint すら破れるケースをフィクスチャが検出)。アンカー座標で解くのを止め:

- **intro より前の前書きコメントは外部化しない**: intro 開始時点で pending コメントを
  出力へフラッシュ(末尾の空行群の手前に挿入)し、stripped 側に inline 温存
- restore の intro 挿入位置を「**先頭のコメント行塊+区切り空行1つの後**」に変更
  (前書きの無い通常ファイルでは従来どおり先頭)

トレードオフ: pool.rs の76行前書きのような塊は stripped に残る(稀なパターンの圧縮を
数十行諦めて完全可逆を取る)。

## 3. 結果 — 全10コーパス **231/231 バイト完全一致**

| コーパス | fixpoint | バイト一致 |
|---|---|---|
| once_cell 5 / serde_core 19 / serde 5 / serde_derive 28 | 全通過 | 全一致 |
| regex(top) 12 / regex-syntax 33 / **regex-automata 72** / memchr 45 | 全通過 | **全一致**(pool.rs 解消) |
| 自分自身 7 / corvid 5 | 全通過 | 全一致 |

docs/38 時点の「既知の非一致(225/226)」と「`/**` 正規化」はともに解消。
現在、既知の非バイト一致クラスは**ゼロ**(病的な空白配置などの理論的余地のみ)。

## 4. 統合テストと CI

- **`tool/tests/roundtrip.rs`**(`CARGO_BIN_EXE_tatamu` で実バイナリを駆動):
  1. `tests/fixtures/` の roundtrip 恒等性(fixpoint 終了コード+全ファイル byte-exact)。
     フィクスチャは docs/36〜38 で潰した故障クラス全部入り(cfg 双子・多行属性・折返し where・
     variant/フィールド doc・fn ローカル item・macro_rules doc・URL `/*`・SAFETY 継続行・
     桁揃えテール・過剰インデントコメント・kept ブロック・行中 `/* */`・`/*!`/`/**`/一行形式・
     前書き+EOF コメント・サブディレクトリ)
  2. 自分自身(tool/src)の roundtrip 恒等性
  3. lens ゲート: モジュール疑似節(`notes hard`)と cfg 双子シャドウ(`notes twin` が両節ヒット)
- **`.github/workflows/ci.yml`**: push/PR で ①tool を `RUSTFLAGS=-D warnings` でビルド+上記テスト、
  ②`transpiler/unit-tests.mjs`(163ケース)。フィクスチャ自作なのでネットワーク不要

開発中にフィクスチャが前書き問題の fixpoint 破れを即検出しており、ゲートとして最初から機能した。
