# Stage 2-7: wasm の文字列・構造体受け渡し 実証レポート

> 2026-08-17 実施。実験: `experiments/ffi-wasm/`(lib.ttm 拡張 + `run-wasm-rich.mjs`)

## 背景

10 の wasm 実証は数値のみだった。実用には文字列・構造体の受け渡しが必要で、wasm-bindgen のような外部ツールに頼らず **C ABI と同じ手作りプロトコル**でどこまで行けるかを検証した(依存を増やさないのは Stage 1 の方針)。

## プロトコル設計(wasm-bindgen 不使用)

- **メモリ管理**: `tatamu_alloc(len) *mut u8` / `tatamu_free(ptr, cap)` を Tatamu 側でエクスポート(`Vec::with_capacity` + `mem::forget` / `Vec::from_raw_parts`)
- **文字列 入力**: JS が UTF-8 エンコード → alloc → wasm メモリに書き込み → `(ptr, len)` で渡す
- **文字列 出力**: 戻り値 1 個で済むよう **u64 に `ptr << 32 | len` をパック**して返す(受け側で分解)
- **構造体**: `#[repr(C)]` レイアウトをそのまま共有。JS は DataView でフィールドのバイトオフセットを読み書きし、ポインタで渡す(`tatamu_midpoint(a *const Point, b *const Point, out *mut Point)`)

この方式の利点: **ネイティブ(C ヘッダ経由)と wasm(JS)が完全に同一の ABI を共有する。** 生成ヘッダにも alloc/free/upper/midpoint がそのまま載り、C からも同じプロトコルで使える。

## 検証結果

```
input : hello tatamu, 畳んで広げる
output: HELLO TATAMU, 畳んで広げる
midpoint of (1,2)-(5,8): 3 5
```

- **文字列往復**: UTF-8 マルチバイト(日本語)込みで正しく往復。`to_uppercase()` の Unicode 処理も正常
- **構造体**: JS が DataView で書いた 2 つの Point を wasm 側が読み、結果 Point を out ポインタに書き戻し、JS が正しく読めた
- メモリ解放も両方向で実施(alloc した 5 バッファ全て free)

wasm サイズは 623B → **26.6KB** に増加。増分はほぼ `to_uppercase` の Unicode テーブルであり、文字列処理を持ち込んだ場合の現実的なサイズ感として記録しておく(それでも十分小さい)。

## Tatamu 言語としての確認事項

- 生ポインタ型(`*const u8`, `*mut Point`)、`unsafe` ブロック、`mem::forget` / `Vec::from_raw_parts` が**仕様追加なしで**既存の変換規則(シグネチャ変換・prelude 注入・セミコロン挿入)に乗った。prelude に `mem::` を1行足しただけ
- `(*out).x = ...` のようなポインタ経由代入も正しく文として処理された

## 残課題

- パック u64 方式は 32bit アドレス空間(wasm32)前提。wasm64 移行時は out-param 方式に変える
- 文字列 API の定型コード(alloc → write → call → read → free)を JS 側ヘルパとして自動生成する余地(cbindgen 相当の JS 版 = 「jsbindgen」が Stage 3 候補)
- 複雑な型(Vec、ネスト struct、enum)の受け渡し規約は未設計
