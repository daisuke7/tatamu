# wasm サイズ最適化レポート

> 2026-08-18 実施。`--project` の Cargo.toml 生成に wasm 専用プロファイルを追加 + wasm-opt(binaryen)を導入。

## 実装

ライブラリクレートの生成 Cargo.toml に **カスタムプロファイル `[profile.wasm]`** を自動追加:

```toml
[profile.wasm]
inherits = "release"
opt-level = "z"       # サイズ優先
lto = true
codegen-units = 1
panic = "abort"
strip = true
```

カスタムプロファイルなので**ネイティブの release / test ビルドには一切影響しない**(mdlite の cargo test 12/12 不変を確認)。ビルドは `cargo build --profile wasm --target wasm32-unknown-unknown`。さらに binaryen の `wasm-opt -Oz` を後段に。

## 実測

| 対象 | release(従来) | profile wasm | + wasm-opt -Oz | 削減率 | gzip 後 |
|---|---:|---:|---:|---:|---:|
| **mdlite**(Markdown 変換、String 処理・フォーマッタ込み) | 71,596 | 43,844 | **37,992** | **−47%** | **17,891** |
| **tatamu-ffi**(数値・文字列・struct/enum FFI デモ) | 27,187 | 19,388 | **17,646** | **−35%** | — |

- 効きの内訳: profile(opt-level=z + LTO + panic=abort + strip)が大半を稼ぎ、wasm-opt が追加で 9〜13% 削る
- **実配信サイズ(gzip)で mdlite は 17.9KB** — Markdown パーサ+HTML レンダラ一式としてはランタイムレスの面目躍如。ブラウザデモの自己完結 HTML も 95KB → **51KB** に半減(最適化 wasm を再埋め込み、動作 smoke 済み)

## 検証

- 最適化 wasm の機能チェック 4/4(見出し / インライン / リスト / 日本語)+ 文字列・struct・データ enum のリッチデモも全て正値
- ネイティブ側(cargo test / CLI)への影響なし
- ユニット 70/70 維持

## トレードオフ・メモ

- `panic = "abort"` により wasm 内パニック時のメッセージ・巻き戻しが消える(サイズと引き換え)。デバッグ時は `--profile wasm` を使わず従来 release でビルドすればよい — プロファイル分離のおかげで使い分けがコマンド1フラグで済む
- wasm-opt は Homebrew の binaryen を導入(`wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int`)。ツールチェーン統合(tatamuc が自動で叩く)は未実装 — ビルドはユーザー側コマンドという現行の役割分担を維持した
- さらに削るなら: `wee_alloc` 系アロケータ差し替え、フォーマッタ(`write!`)排除、`--enable-*` 追加機能 — 必要になったら
