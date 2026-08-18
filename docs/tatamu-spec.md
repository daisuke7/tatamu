# Tatamu 言語仕様(v0.6)

> 2026-08-18 版(v0.6: priv / macro_rules / ネストモジュール / enum 判別子 / async 検証)。docs/00〜25 の設計・実験・改定を1ファイルに統合した正式リファレンス。
> LLM のコンテキスト常駐用の圧縮版仕様は `experiments/llm-generation/prompt-tatamu.md`(few-shot 例付き)。

## 1. 概要

**Tatamu(畳む)**は、AI(LLM)がコードを書くことを第一に設計された、Rust への 1:1 トランスパイル言語である。設計原則は2つ:

1. **AI にとって Rust と同等以上の開発効率** — LLM が持つ Rust の知識・直感がそのまま転移するよう、圧縮は「機械的に復元可能な省略」に限定し、難しい構文(型システム系)は Rust のまま残す
2. **Rust より明らかに少ないトークン消費** — 実測: 同一仕様を最初から Rust で書いたコード比 **−42.2%**(mdlite、256行・テスト付き)、機械展開した Rust 比 −13.8〜−17.2%

意味論は Rust と同一(所有権・借用・型システム・ライフタイム全て)。差は構文・書式・ツーリングに閉じる。ファイル拡張子は `.ttm`。

## 2. 書式規則

- **インデント禁止** — すべての行は列0から始まる(展開時に rustfmt 風インデントが再生成される)
- **改行が文の終端** — `;` は不要。同一行に複数文を書くときだけ `;` で連結する
- **空行なし・コメントなし** — ドキュメントはアウトオブバンド(§10)。`//` `/* */` は診断対象
- 文字列リテラル(`"…"`、`r#"…"#`、`'c'`)の内部はすべての規則から保護される

## 3. 束縛と代入

| 形 | Tatamu | 展開後の Rust |
|---|---|---|
| 不変束縛 | `x := expr` | `let x = expr;` |
| 可変束縛 | `mut x := expr` | `let mut x = expr;` |
| タプル分解 | `(a, b) := expr` | `let (a, b) = expr;` |
| 型注釈付き | `x: Vec<_> := expr` | `let x: Vec<_> = expr;` |
| 再代入 | `x = expr` | `x = expr;` |

- **型注釈は「Rust が要求する箇所」にだけ書く**(`collect()` の目標型、`parse()?` の目標型など)。Rust が推論できる箇所には書かない
- ターボフィッシュ(`.sum::<f64>()`)も Rust が必要とする場面では許容
- `let` は束縛には使わない。ただし **`if let` / `while let` はパターンマッチ構文としてそのまま使う**

## 4. 関数

```
fn add(a i64, b i64) i64 {a + b}
fn largest<T: PartialOrd + Copy>(list &[T]) T {…}
fn longest<'a>(x &'a str, y &'a str) &'a str {…}
fn gcd(mut a u64, mut b u64) u64 {…}
```

- パラメータの `:` と戻り型の `->` を省略(`名前 型` の並置、戻り型は `)` の直後)
- **ジェネリクス・ライフタイム・トレイト境界は Rust のまま**、名前の直後に書く
- `self` / `&self` / `&mut self`、デフォルト実装、トレイト内宣言(本体なし)も同形
- 末尾式・`return`・`?` は Rust と同じ

## 5. 可視性

`pub` は書かない。**すべてデフォルト公開** — ライブラリモジュールの項目・メソッド・フィールドには展開時に `pub` が自動付与される(トレイト実装内メソッドは除外)。

非公開にしたい項目・フィールドには **`priv` を前置**する(展開時に `pub` が付かない = Rust のモジュールプライベート):

```
priv fn helper() u8 {1}
struct S {priv secret u8, open u8}
priv struct Hidden {x u8}
impl S {
priv fn internal(&self) u8 {self.secret}
}
```

## 6. struct / enum

```
struct Point +Debug,Clone {x f64, y f64}
struct Stack<T> {items Vec<T>}
enum Shape +Debug {Circle(f64), Rect {w f64, h f64}, Empty}
```

- **derive は `+リスト` を名前の後置**(`#[derive(…)]` 行を排除)。外部クレートの derive は修飾パスで書く: `+Debug,serde::Serialize`
- **フィールドは `名前 型` のカンマ区切り**(struct 本体、enum の struct-variant とも)。単一行・複数行どちらも可
- struct **リテラル**・match **パターン**は Rust のまま(`Point {x: 1.0}`、`Shape::Rect {w, h} =>`)
- タプル/ユニット variant、`impl` / `impl<T>` / `impl Trait for Type`、関連型(`type Err = String`)は Rust のまま
- 明示判別子は Rust のまま書ける: `enum Msg {Ping = 10, Data {x f64} = 20}` — データ付き variant に判別子を付ける場合は Rust の要件どおり `#[repr(C, i32)]` 等の整数型併記が必要(FFI バインディングのタグ値にも反映される)
- `const NAME 型 = 式`(`:` 省略)

## 7. import 解決

- **`use` 文は書かない。** std の頻出名(HashMap / HashSet / fs / env / thread / mpsc / fmt / mem / Arc / Mutex / Display / FromStr / Ordering など)は使用を検出して自動注入。外部クレートの項目はフルパスで参照する(`serde_json::to_string(&x)`)
- **`#use` 指令**が唯一の明示 import: トレイトをスコープに入れる必要がある場合に使う
  ```
  #use std::fmt::Write
  ```
- モジュール間参照(§9)も自動解決

## 8. ディレクティブ(ファイル先頭の `#` 行)

| 指令 | 意味 |
|---|---|
| `#dep name version` | Cargo.toml の依存に追加 |
| `#dep name version features=a,b` | features 付き依存 |
| `#crate staticlib,cdylib,rlib` | `[lib] crate-type` を指定(bin 併存時は rlib 必須) |
| `#use path::To::Trait` | 明示 use 注入(§7) |

## 9. プロジェクト構成(`tatamuc --project`)

- ディレクトリ内の各 `.ttm` が1モジュール。**サブディレクトリはネストモジュール**になる(`net/http.ttm` → `crate::net::http`。中間モジュールファイルは自動合成され、`.ttm` を置けば自分のコードも持てる)。`main.ttm` → bin、`lib.ttm` → lib、**両方あれば bin+lib**(lib.rs がモジュールルート、main.rs はクレート経由で消費)
- モジュール間の項目参照は名前検出で `use crate::<mod>::*;` を自動注入。`mod` 宣言も自動生成
- テストは `#[test]` fn をトップレベルに書く(`mod tests` 不要)。テスト専用モジュールの未使用 import lint は自動抑制
- ライブラリクレートには C ヘッダ / JS / TypeScript / Dart の各バインディング(§11)と wasm 用サイズ最適化プロファイル(`--profile wasm`)が自動生成される

## 10. ドキュメント(アウトオブバンド)

コード内コメントは禁止。ドキュメントはサイドカー **`<name>.doc.md`** に置く:

```markdown
# <モジュール概要>          → //! に展開

## <項目名>                 → その fn/struct/enum/trait/const の /// に展開
`fn parse(text &str) R<Config>`   ← 鮮度管理用のシグネチャ記録(doc 出力には含まれない)
<本文>
```

- アンカーは行番号ではなく**項目名**(コード編集で壊れない)
- `--doc-check` が orphan(error)/ stale-signature(warning・diff付き)/ missing(info)を検出、`--doc-sync` が記録更新とスタブ追記を行う
- 通常タスクの LLM コンテキストには `.ttm` のみを載せる(コメント分のトークンコスト = 0)

## 11. 型エイリアスと FFI

- **`R<T>`** = `Result<T, Box<dyn Error>>`(唯一の組み込みエイリアス。単純な型名短縮はトークン削減にならないため存在しない)
- `extern "C" fn` + `#[no_mangle]`、`extern "C" {}` ブロック、`#[repr(C)]` は Rust のまま書く。シグネチャは Tatamu 形式
- **文字列返却の規約: out-param 方式**(`fn f(…, out_len *mut usize) *mut u8`)。パック u64(`ptr<<32|len`)は 64bit ネイティブで壊れるため生成バインディングの内部プロトコルとしても使わない
- `*_alloc` / `*_free` エクスポートを置くと、各言語バインディングの文字列/struct ヘルパが自動生成される:
  - `include/<crate>.h` — C(struct topo ソート、enum は `Enum_Variant` 定数、データ enum は tag+union)
  - `js/<crate>.mjs` + `.d.mts` — wasm 用(struct/配列/enum/データ enum のマーシャリング、判別合併型、固定長タプル型)
  - `dart/<crate>.dart` — Flutter / dart:ffi 用

## 12. 寛容モード(入力の許容)

トランスパイラは以下を**エラーにせず吸収**する(弱い LLM の出力対策):
行末の余分な `;`(剥がして規則的に再付与)/ ターボフィッシュ(有効な Rust なのでそのまま)/ パラメータのコロン付き注釈。
一方、`let` 束縛・`use` 行・`->`・`#[derive]`・`pub`・コメント・`mut x = expr`(束縛か再代入か曖昧)は `--check` が修正提案付きで検出する。

## 13. ツールチェーン(tatamuc)

| コマンド | 機能 |
|---|---|
| `tatamuc file.ttm` | Rust に展開して stdout |
| `--check` | 構文層の診断(修正提案付き構造化 JSON) |
| `--compile <file\|dir>` | rustc / cargo check を実行し、エラーを **.ttm のファイル・行番号に逆マップ**して JSON 返却 |
| `--project <src> <out>` | cargo プロジェクト生成(§9 + §11 の全成果物) |
| `--header` / `--jsbind` / `--dts` / `--dartbind` | 各バインディング単体生成 |
| `--docs <sidecar>` | doc コメント付き Rust に展開 |
| `--doc-check` / `--doc-sync` | doc 鮮度検査 / 同期(§10) |

想定ワークフロー: 生成 → `--check` → `--compile`(すべて .ttm 座標系)→ 修正 → `--project` + cargo。

---

## 14. Rust との差異(対照表)

### 14.1 書き方が変わるもの

| | Rust | Tatamu | 差の性質 |
|---|---|---|---|
| 文終端 | `expr;` | 改行(連結時のみ `;`) | 書式 |
| インデント | 自由(慣習 4sp) | 禁止(列0) | 書式 |
| コメント | `//` `/*…*/` `///` | 禁止 → サイドカー `.doc.md` | 書式+運用 |
| 束縛 | `let x = e;` / `let mut x = e;` | `x := e` / `mut x := e` | 構文 |
| 関数 | `fn f(a: T) -> U` | `fn f(a T) U` | 構文 |
| derive | `#[derive(A, B)]` 行 | `+A,B` 後置(struct/enum とも) | 構文 |
| フィールド | `name: Type,`(縦) | `name Type,`(横可) | 構文 |
| const | `const N: usize = 3;` | `const N usize = 3` | 構文 |
| import | `use` 文を手書き | 自動解決(+ `#use` はトレイトのみ) | ツール |
| 可視性 | `pub` を明示 | 全公開デフォルト+`priv` 前置で非公開 | 構文(反転) |
| モジュール | `mod x;` を手書き | ファイル=モジュール、自動 | ツール |
| テスト | `#[cfg(test)] mod tests { use super::*; …}` | トップレベル `#[test]` fn | 構文 |
| 依存 | Cargo.toml を手書き | `#dep` 指令 | ツール |
| Result 定型 | `Result<T, Box<dyn Error>>` | `R<T>` | エイリアス |

### 14.2 Rust のまま変わらないもの

式・演算子・制御構文(`if`/`for`/`while`/`loop`/`match`)、パターン(`if let`/`while let` 含む)、クロージャ、マクロ呼び出し(`println!` 等)、**`macro_rules!` 定義**(本体内も Tatamu 記法で書ける — 行単位変換のため)、**`async`/`.await`/`#[tokio::main]`/`select!`**(tokio 実プログラムで検証済み)、`?`、**ジェネリクス・ライフタイム・トレイト境界・where**、トレイト定義と `impl`(関連型含む)、enum の variant 構文(フィールドのコロン以外)、struct リテラル、`unsafe`、生ポインタ、属性(`#[test]` `#[no_mangle]` `#[repr(C)]` …)、リテラル(raw string 含む)、演算子オーバーロード、スレッド/チャネル等の std API 全部。

**所有権・借用・型検査は完全に Rust** — Tatamu は意味論を1ビットも変えない。エラーも rustc のものが(.ttm 座標に変換されて)そのまま返る。

### 14.3 差異の設計根拠(実測より)

- キーワードの記号化・型名の単純短縮は**やらない** — キーワードは平均 0.81 トークンで既に最安、`Vec<String>`→`V<S>` は効果ゼロ、Unicode 記号は逆に高い(docs/01)
- 削るのは「識別子の繰り返し・書式・定型文・コメント」— トークンの行き先の実測(識別子 26.8% / コメント 21.9% / 空白 21.5% / 記号 18.9%)に基づく
- 「Rust の直感に沿わせる」ほど生成成功率が上がる — v0.1→v0.2 で Haiku の違反 37→0(docs/05)。型システム系構文を Rust のまま残した部分は全モデル・全課題でエラーゼロ(docs/06)

### 14.4 意図的な非対応(制限ではなく設計・環境の性質)

v0.6 で従来の制限(可視性 / サブディレクトリ / macro_rules / async / enum 判別子)はすべて解消した。残るのは意図的なものと C ABI の性質のみ:

- **インラインコメント** — 設計上の禁止。ドキュメントはサイドカー(§10)が正式な置き場で、`--check` が `no-comments` で誘導する
- **FFI でのジェネリック型・可変長ネスト型の受け渡し** — Tatamu の制限ではなく C ABI の性質(Rust の extern "C" でも同様)。モノモーフィックなラッパ関数を書いて渡すのが正道
- FFI バインディングのデータ enum タグは 32bit(`#[repr(C, i32)]` / `u32`)のみ対応

---

## 付録: 検証状況(2026-08-18)

- LLM 生成: 4 Claude モデル × 易6+難6課題 + 外部クレート課題、**全コンパイル通過**・規則違反ゼロ
- ターゲット: CLI / wasm(ブラウザ実行、gzip 17.9KB)/ iOS・Android(Flutter 実機シミュレータ/エミュレータで実起動)
- FFI: C 双方向・JS/TS・Dart、struct/配列/enum/データ enum のレイアウトは Rust `offset_of` の const assert とパリティ証明済み
- テスト: ユニット70 + サニティ29 + 生成コーパス48 + ドッグフーディング2本(ttmstat / mdlite)
