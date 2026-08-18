# Stage 2-10: TypeScript 型定義(.d.ts)生成 実装レポート

> 2026-08-17 実施。`tatamuc --dts <file.ttm>` として実装。`--project` は `js/<crate>.d.mts` を自動出力。

## 実装

`parseCAbi`(C ヘッダ・JS バインディングと共通の解析)から TypeScript 宣言を生成:

- **struct → interface**: `#[repr(C)]` struct をフィールド型付き interface に(ネスト struct はその interface 名を参照)
- **型マップ**: i8〜u32 / f32 / f64 / usize → `number`、i64 / u64 → `bigint`、bool → `boolean`、ポインタ → `number`(wasm32 アドレス)
- **エクスポート関数**: i64/u64 引数は `number | bigint`(バインディングが `BigInt()` 変換するため)、戻り値は正確に `bigint` / `number` / `void`
- **phantom ジェネリクスによる型推論**: `StructDesc<T>` に `readonly __type?: T` を持たせ、`readStruct<T>(desc: StructDesc<T>, ptr): T` が **descriptor から戻り型を推論**する。`m.readStruct(structs.Segment, p)` の戻りは自動的に `Segment` 型になり、`seg.a.x` のネストアクセスまで型が通る
- 未対応型・struct 値渡し(wasm では ABI 依存)は警告

## 検証(tsc 7.0 による実型検査)

**正例** — 生成 `.d.mts` に対する消費コード(load / tatamu_add / allocStruct / readStruct のネスト推論 / unpackString)が `--strict` で型検査 **通過**。

**負例** — 誤りが全て検出されることを確認:

| 誤り | エラー |
|---|---|
| `allocStruct(structs.Point, {x: 1, z: 2})` | TS2353: 'z' does not exist in type 'Point' |
| `const s: string = m.tatamu_add(1, 2)` | TS2322: 'bigint' is not assignable to 'string' |
| `readStruct(structs.Point, 0).a.x` | TS2339: Property 'a' does not exist on type 'Point' |

## 到達点

`tatamuc --project` の出力一式が完成形になった:

```
src/*.rs           — 展開された Rust(cargo でネイティブ / wasm ビルド)
include/<crate>.h  — C / Swift / Kotlin 連携用ヘッダ(依存順ソート済み)
js/<crate>.mjs     — wasm 用 JS バインディング(struct マーシャリング+文字列ヘルパ)
js/<crate>.d.mts   — その型定義(ネスト struct の型推論まで有効)
```

00-concept の「この言語で書いたコードを他の言語から利用できる手段」は、C(ヘッダ)・JS(バインディング)・TypeScript(型定義)の3面で自動生成が揃った。

## 残課題

- enum / 配列フィールド(14 と共通)
- `exports` プロパティの精密型付け(現状 `WebAssembly.Exports`)
- JSDoc コメント(サイドカー docs との連携 — 09 の `.doc.md` を `.d.mts` の doc comment にも流せる)
