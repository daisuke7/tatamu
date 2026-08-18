# Stage 2-1: 難課題での限界測定 結果レポート

> 2026-08-17 実施。[05-llm-generation-v2.md](05-llm-generation-v2.md) の次のステップ 1 に対応。
> 課題: `experiments/hard-tasks/tasks.md`、手書き: `hard-tasks/tatamu/`、生成物: `hard-tasks/outputs/`

## 目的

ジェネリクス・ライフタイム・enum・std トレイト実装・スレッドを含む難課題6本で v0.2 仕様の穴を洗い出し、塞いだ上で LLM 生成のコンパイル通過率を測る。

課題: largest(ジェネリック関数+トレイト境界)/ longest(明示ライフタイム)/ shapes(enum + match)/ hms(Display + FromStr + 関連型)/ threads(std::thread + mpsc)/ stack(ジェネリック struct + impl\<T\>)

## 見つかった仕様の穴と対処(v0.3)

手書きで6本を書き、トランスパイラに通して発見:

| 穴 | 対処 |
|---|---|
| ジェネリックパラメータ(`fn largest<T: PartialOrd>`、`struct Stack<T>`)が未定義でシグネチャ変換が壊れる | **名前直後の `<...>` を Rust のまま verbatim 保持**するようトランスパイラ拡張。仕様に明文化 |
| enum・関連型(`type Err = String`)・std トレイト実装の扱いが未定義 | 「Rust のまま書く(内部の fn シグネチャは Tatamu 形式)」と明文化。トランスパイラはパススルーで対応済みと確認 |
| 複数行クロージャを渡す呼び出し文(`thread::spawn(move || {…})`)の閉じ `})` に `;` が付かず型エラー | セミコロン挿入のブロックスタックを丸括弧 `(` も追跡するよう書き換え |
| prelude 不足(fmt / Formatter / thread / mpsc / FromStr / Display / Arc / Mutex / Ordering) | prelude マップに追加 |

手書き6本は対処後 **6/6 コンパイル成功**(1本は借用エラーで、これは筆者のコーディングミスであり言語仕様の問題ではない)。

## LLM 生成結果(v0.3 仕様、4モデル × 6課題)

**24/24 コンパイル成功、型推論エラーもゼロ。**

- 全モデルが `fn largest<T: PartialOrd + Copy>(list &[T]) T` 形式のジェネリクス+Tatamu シグネチャの合成を正しく書いた(few-shot に例が1つもない構文の組み合わせ)
- ライフタイム `fn longest<'a>(x &'a str, y &'a str) &'a str` も4モデル全て正解
- Haiku は `std::fmt::Display` のように完全修飾パスを使う傾向(prelude 非依存で堅牢な戦略。トークンはやや多い)
- Fable は bare `Formatter<'_>` を使い prelude の不足を1件暴いた(Formatter を追加して解決)

## 知見

1. **「Rust のまま」領域の明文化が効く。** 難構文をむりに圧縮せず「exactly Rust」と宣言した部分(ジェネリクス・enum・トレイト実装)は、モデルの既存知識がそのまま働き、一切のエラーを生まなかった。05 の知見(母体言語の直感に沿わせる)の再確認。
2. 圧縮対象(束縛・シグネチャ・derive)と非圧縮対象(型システム系構文)の境界が、この実験で実証的に引けた。
3. 残る未踏領域: async(std のみでは実行系がなく課題化を見送り)、マクロ定義、モジュール分割(→ Stage 2-3 で対応)。
