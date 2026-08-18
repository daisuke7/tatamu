# Stage 2-11: 配列 / enum フィールドのレイアウト対応 実装レポート

> 2026-08-18 実施。C ヘッダ・JS バインディング・.d.ts の3面を同時に拡張。

## 対応範囲

- **配列フィールド** `[T; N]` — 要素はスカラ・struct・enum いずれも可(ネスト可)
- **fieldless の `#[repr(C)] enum`** — C の int 表現(4バイト)。struct フィールド・関数引数/戻り値として使用可
- データ付き enum(タグ付き union)は対象外のまま(警告してスキップ)

## 3面の生成結果(`Path {kind Unit, points [Point; 3], count u32}` の例)

| 面 | 出力 |
|---|---|
| C ヘッダ | `typedef enum { Unit_Meters = 0, Unit_Feet = 1 } Unit;` +`Point points[3];`(変数名衝突を避けるため variant は `Enum_Variant` 形式、配列は C の宣言子構文) |
| JS バインディング | descriptor `["points", "Point[3]", 8]` + `export const Unit = Object.freeze({Meters: 0, Feet: 1})`。read/write は `readValue`/`writeValue` に一般化し、配列は stride 計算で JS 配列 ⇄ メモリを再帰変換 |
| .d.ts | `export type Unit = typeof Unit[keyof typeof Unit]`(リテラル合併型 `0 \| 1`)+ **固定長タプル** `points: [Point, Point, Point]`(N ≤ 16、超は `T[]`) |

## 検証

1. **レイアウト正当性**: Rust の const assert(wasm32)と JS 生成値が完全一致 — `Unit` = 4B、`Path` は kind@0 / points@8 / count@56 / size 64(配列 48B とパディングを含む)
2. **実行**: JS から `{kind: Unit.Meters, points: [(0,0),(3,4),(6,8)], count: 3}` を書き込み → wasm 側 `tatamu_path_len` が **10**(3-4-5 三角形×2)、`writeValue('Unit', ptr, Unit.Feet)` で書き換えると **3.048**(フィート換算)。ネスト配列込みの roundtrip も一致
3. **型検査(tsc --strict)**: 正例通過。負例は3種とも検出 — enum に範囲外リテラル `5`(TS2322)、要素数2の配列を `[Point, Point, Point]` に代入(TS2322: requires 3)、存在しない variant `Unit.Yards`(TS2339)
4. **C ヘッダ**: enum 初期化子つき struct リテラルを含む C コードが `-fsyntax-only` 通過
5. 回帰: サニティ29本・生成コーパス緑

## 設計メモ

- enum の variant 値は明示指定(`A = 5`)を尊重し、以後自動インクリメント
- 固定長タプル型のおかげで「配列の要素数間違い」がコンパイル時に落ちる — FFI で最も踏みやすいミスの一つを型で防げる
- Tatamu 言語仕様への追加はゼロ(enum は「Rust のまま」領域、配列型はフィールド型文字列として素通し)。変更は全てバインディング生成層に閉じた

## 残課題

- データ付き enum(タグ付き union)のマーシャリング規約
- 多次元配列 `[[f64; 2]; 3]`(現状は1次元のみ想定、要素側の再帰はあるため小改修で可)
- C ヘッダの enum 型幅注記(コンパイラ依存で int 以外になり得るケースへの防御)
