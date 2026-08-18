# Stage 2-9: ネスト struct レイアウト対応 実装レポート

> 2026-08-17 実施。`transpiler/tatamuc.mjs` の JS バインディング生成・C ヘッダ生成を拡張。

## 実装

### 1. JS バインディング: 再帰レイアウト計算

struct 型フィールド(`Segment {a Point, b Point}`)を再帰的に解決し、wasm32 の C レイアウト規則(フィールドごとのアラインメント調整+末尾パディング)でオフセットを計算する。

- 循環参照(値による再帰 struct)は警告してスキップ(Rust でもコンパイル不能なため安全側)
- 生成される descriptor に `align` を追加: `Segment: { size: 32, align: 8, fields: [["a", "Point", 0], ["b", "Point", 16]] }`
- `readStruct` / `writeStruct` はフィールド型がスカラでなければ**ネストした descriptor で再帰**し、JS 側はネストしたプレーンオブジェクト(`{a: {x, y}, b: {x, y}}`)をそのまま読み書きできる

### 2. C ヘッダ: 依存順トポロジカルソート

C は使用前宣言が必須のため、struct をフィールド依存の順に並べ替えて出力。検証として `.ttm` 内で意図的に Segment を Point より**前**に定義したが、ヘッダは Point → Segment の順で正しく出力された。

### 3. 副産物: 複数行 `unsafe` 末尾式の穴を修正

検証用の `tatamu_seg_len` が「複数行 `unsafe { … }` ブロックが関数の末尾式」というパターンを踏み、末尾式に `;` が付く既存の穴が露見。ブロックの閉じ位置を先読みし、値文脈の末尾にある `unsafe {` ブロックを値ブロックとして扱うよう修正した(文の位置にある `unsafe` ブロックは従来どおり)。

## 検証

- **実行**: `allocStruct(structs.Segment, {a: {x: 0, y: 0}, b: {x: 3, y: 4}})` → wasm 側 `tatamu_seg_len` が **5**(3-4-5 三角形)、`readStruct` の往復も入力と完全一致
- **レイアウト正当性の証明**: 同じ構造体を Rust の `offset_of!` / `size_of` の **const assert としてコンパイル時検証**(wasm32 ターゲット)。Point 16 / Segment 32(b@16)/ 混合アラインメントの `Tagged {tag u8, value f64, count u32}` は {0, 8, 16} size 24 — JS 生成値と全て一致
- ネストのネスト(`Wrap {inner Tagged, flag bool}` → flag@24, size 32)も正しい
- 回帰: 29本サニティ、生成コーパス 48本コンパイル、cargo プロジェクト、ネイティブ staticlib 再ビルド全て緑

## 残課題

- 配列フィールド(`[f64; 4]`)・enum(タグ付き union)のレイアウトは未対応
- C ヘッダ側の前方宣言(ポインタのみの循環参照)は未対応
- `.d.ts` を生成すればネスト構造の型安全もそのまま手に入る(次候補)
