# Stage 2-8: --compile 複数ファイル対応 / JS バインディング自動生成 実装レポート

> 2026-08-17 実施。両機能とも `transpiler/tatamuc.mjs` に実装。

## 1. `--compile` の複数ファイル対応

### 実装

- `buildProject` を行番号マップ付きに拡張(`{files, maps}` を返す)。`#dep` / `#crate` 指令行の除去、mod/use ヘッダの前置による行ズレも全てマップに反映
- `tatamuc --compile <dir>` はディレクトリを検知すると: プロジェクト生成 → 一時ディレクトリへ書き出し → `cargo check --message-format=json` → 各診断の span(`src/<mod>.rs` の行)を **`<mod>.ttm` のファイル名+行番号**に逆マッピング

### 検証

cargo-project デモの `storage.ttm` に型エラー(qty に String を代入)を仕込むと:

```json
{"level": "error", "code": "E0308", "file": "storage.ttm", "line": 12,
 "found": "items.push(Item {name: ..., qty: parts[1].to_string(), ...})",
 "message": "mismatched types"}
```

— 正しいファイル・正しい行・該当 Tatamu 行テキストで返る。健全なプロジェクトは `ok: true`。これで単一ファイル(11)と複数ファイルの両方で「LLM は `.ttm` の座標系だけ見ればよい」状態になった。

## 2. JS バインディング自動生成(`--jsbind` / jsbindgen 相当)

### 実装

`parseCAbi`(ヘッダ生成と共通化した C ABI 解析)から ES モジュールを生成:

- **struct マーシャリング**: `#[repr(C)]` struct の wasm32 レイアウト(アラインメント込みのオフセット計算)を descriptor 化し、`allocStruct` / `readStruct` / `writeStruct` / `freeStruct` を提供
- **文字列ヘルパ**: `*_alloc` / `*_free` エクスポートを自動検出し、`writeString`(UTF-8 書き込み)/ `readString` / `unpackString`(12 のパック u64 プロトコルをデコード+自動 free)を生成
- **型付きエクスポートラッパ**: 各 extern fn をメソッド化し、i64 / u64 引数は自動で `BigInt` 変換
- 未対応フィールド型は警告してその struct をスキップ(ヘッダ生成と同じ寛容方針)
- `--project` はライブラリクレートに対し `js/<crate>.mjs` を自動出力 — **`tatamuc --project` 一発で `.a` + `.h` + `.mjs` の三点セット**が揃う

### 検証

手書き版デモ(run-wasm-rich.mjs)と同じ内容を生成バインディング経由で実行:

```
add(20, 22)  = 42n
fib(50)      = 12586269025n
upper        = HELLO TATAMU, 畳んで広げる
midpoint     = { x: 3, y: 5 }
```

手書きの DataView / バイトオフセット / パック分解コードが全て消え、呼び出し側は `m.allocStruct(structs.Point, {x: 1, y: 2})` / `m.unpackString(...)` だけになった。既存29本の回帰も通過。

## 残課題

- struct 内 struct(ネスト)・配列フィールドのレイアウト計算は未対応
- wasm64 移行時は usize/ポインタ幅(現在 4 バイト固定)とパック u64 方式の見直しが必要
- TypeScript 型定義(`.d.ts`)の同時生成は未実装(構造は揃っているので機械的に足せる)
