# Stage 2-5: C ABI / wasm ターゲット実測レポート

> 2026-08-17 実施。00-concept の要件「モバイルネイティブ(C ABI)」「Web(wasm)」の実証。
> 実験: `experiments/ffi-wasm/`(lib-ttm / c-caller / c-lib / tatamu-caller / run-wasm.mjs)

## 結論

**単一の `lib.ttm` から、ネイティブ staticlib(C から呼べる)と wasm(ブラウザ/Node で動く)の両方が生成・実行できた。** C ライブラリを Tatamu から呼ぶ逆方向も成功。00-concept のターゲット環境要件(CLI / モバイル / Web)と FFI 双方向要件は、Stage 1 のアーキテクチャ(Rust トランスパイル)でそのまま成立することが実測で確認された。

## 実測 1: Tatamu → C(エクスポート / モバイル要件の核)

`lib.ttm`(`#crate staticlib,cdylib` 指令 + `#[no_mangle] extern "C" fn` 3関数)から:

```
tatamuc --project → cargo build → libtatamu_ffi.a
cc main.c libtatamu_ffi.a → 実行
```

C からの呼び出し結果: `add(20,22)=42`、`fib(50)=12586269025`、`gcd(48,180)=12` — 全て正しい。

これは 00-concept の「C ABI の静的ライブラリとして Kotlin / Swift から呼ぶ」経路の土台がそのまま動くことを意味する(Swift/Kotlin は C ヘッダ経由で同じ .a をリンクする)。

## 実測 2: C → Tatamu(インポート)

```
extern "C" {
fn c_mul(a i64, b i64) i64
fn c_hypot(a f64, b f64) f64
}
```

Tatamu の extern ブロックが正しい Rust(`fn c_mul(a: i64, b: i64) -> i64;`)に変換され、`cc -c` + `ar` で作った C 静的ライブラリとリンクして実行成功(`c_mul=42`, `c_hypot=5`)。**既存のシグネチャ変換規則が extern 宣言にもそのまま機能し、仕様追加は不要だった。**

## 実測 3: Tatamu → wasm(Web 要件)

rustup で `wasm32-unknown-unknown` ターゲットを追加後、**同じ lib.ttm を一切変更せず**:

```
cargo build --release --target wasm32-unknown-unknown → tatamu_ffi.wasm(623 バイト)
node run-wasm.mjs → WebAssembly.instantiate で実行
```

結果: `exports: memory, tatamu_add, tatamu_fib, tatamu_gcd`、全関数が正しい値(i64 は JS 側で BigInt として受け渡し)。

**623 バイト**という wasm サイズは、00-concept の意味論検討(GC vs 所有権)で懸念した「wasm サイズ」への回答でもある — Rust 母体を選んだことで、ランタイムレスの極小 wasm がデフォルトで手に入る。

## 追加したトランスパイラ機能

| 機能 | 内容 |
|---|---|
| `#crate <types>` 指令 | Cargo.toml に `[lib] crate-type = [...]` を生成 |
| ライブラリクレート対応 | `main.ttm` がなく `lib.ttm` があれば `src/lib.rs` ルートとして構成(pubify 適用) |
| `mut` 付きパラメータ | `fn f(mut a u64)` → `fn f(mut a: u64)` |
| extern fn の pub 付与 | `extern "C" fn` もライブラリの公開 API として `pub` に |

回帰: 既存29本サニティ + 全コンパイルコーパスに影響なし。

## C ヘッダ自動生成(同日追記)

cbindgen 相当の最小版を `tatamuc --header <file.ttm>` として実装。`--project` はライブラリクレートに extern エクスポートがあれば `include/<crate>.h` を自動生成する。

- **検出対象**: `#[no_mangle] extern "C" fn`(関数プロトタイプ化)と `#[repr(C)] struct`(`typedef struct` 化)
- **型マップ**: i8〜u64 → `int8_t`〜`uint64_t`、f32/f64 → `float`/`double`、bool、usize/isize → `uintptr_t`/`intptr_t`、`*const T`/`*mut T` → `const T*`/`T*`、repr(C) struct 名はそのまま
- **未対応型は警告**: `String` など C ABI 非互換の型はエラーではなく `warning: unmapped type` + コメント入りで出力し、修正箇所を明示
- インクルードガード・`extern "C"` C++ ガード付き

検証: `Point {x f64, y f64}`(repr(C))と `tatamu_dot(a Point, b Point) f64` を追加 → 生成ヘッダだけを `#include` する C プログラムがコンパイル・実行成功(`dot({1,2},{3,4}) = 11.0` — struct の値渡しも正しく動作)。手書きしていた extern 宣言は全廃できた。

## 残課題
- 実機モバイル(Xcode / Android NDK)への組み込みは未実施 — staticlib が動いた時点で経路は実証済みだが、ビルドシステム統合は別作業
- wasm の文字列・構造体受け渡し(現状は数値のみ)— wasm-bindgen 相当をどう扱うかは Stage 3 の検討事項
- 環境メモ: この環境では Homebrew Rust と rustup が併存(rustup は `--no-modify-path` で導入、`~/.cargo/bin` を明示 PATH に足して使用)
