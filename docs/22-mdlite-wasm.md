# mdlite wasm 化レポート: 1ソースツリーから CLI + wasm + ブラウザデモ

> 2026-08-18 実施。[21-dogfooding-2.md](21-dogfooding-2.md) の続き。デモ: `dogfood/mdlite/web/index.html`

## 実現したこと

**`dogfood/mdlite/src-ttm/` に `lib.ttm`(22行の wasm エクスポート)を1ファイル足しただけ**で、同一ソースツリーから:

1. **CLI**(`cargo run demo.md` — 従来どおり)
2. **ライブラリ + wasm**(`cargo build --target wasm32-unknown-unknown` → 71.6KB の cdylib)
3. **テスト**(`cargo test` 12/12 維持)
4. **ブラウザデモ**(wasm を base64 埋め込みした自己完結 HTML、textarea 入力の Markdown をリアルタイムに変換表示)

が全て出るようになった。00-concept の「同じフロントエンドからネイティブと wasm」を、実アプリで最初から最後まで通した形。

## ツール拡張: `--project` の bin + lib 共存

これまで `main.ttm`(bin)と `lib.ttm`(lib)は排他だった。今回:

- 両方あるときは **lib.rs をモジュールルート**(`pub mod block;` …)にし、**main.rs はクレート経由**(`use mdlite::render::*;` — クロスモジュール自動解決がクレート名参照に切り替わる)で消費する構成に拡張
- `#crate cdylib,rlib` — cdylib(wasm 用)と rlib(bin がリンクするため)の併記が必要という Cargo の要件はユーザーが `#crate` で明示する(mdlite で実際に必要になった知見)

bin のみ / lib のみの既存プロジェクトは回帰なし(cargo-project / ffi-wasm 両方で確認)。

## lib.ttm の中身

12 で確立した alloc/free + パック u64 文字列プロトコルをそのまま適用(`md_alloc` / `md_free` / `md_to_html`)。**mdlite 本体(block/inline/render)は 1 文字も変更していない** — 変換ロジックが純粋関数(`to_html(&str) -> String`)だったため、FFI 層は完全に外付けできた。

## 検証

- `cargo test` 12/12(lib ターゲット)、CLI 出力不変
- wasm を生成 JS バインディング(`js/mdlite.mjs`)経由で Node 実行 — 日本語込みの Markdown が正しく変換
- ブラウザデモの埋め込み wasm をヘッドレスで smoke test(デモページと同一コードパス)

## メモ

- wasm サイズ 71.6KB(String 処理・フォーマッタ込み)。ランタイムレスとしては妥当だが、`wasm-opt` や `opt-level = "z"` での縮小は未着手(必要になったら)
- ブラウザデモは手書きの最小 JS(≈30行)。生成 `.mjs` バインディングをそのまま `<script type="module">` で使う形は、単一ファイル要件(base64 埋め込み)とのトレードオフで今回は見送り
