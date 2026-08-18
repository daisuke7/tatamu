# Stage 2-3: cargo プロジェクト対応 実装レポート

> 2026-08-17 実施。`tatamuc --project <srcdir> <outdir>` として実装。デモ: `experiments/cargo-project/`

## 機能

`.ttm` ファイルのディレクトリを cargo プロジェクトに展開する:

- `main.ttm` → `src/main.rs`、他の `<name>.ttm` → `src/<name>.rs`
- `main.rs` に `mod <name>;` を自動生成
- **クロスモジュール解決**: 各モジュールのトップレベル項目名(fn / struct / enum / trait / const)を収集し、他ファイルがその名前を参照していれば `use crate::<mod>::*;` を注入
- **可視性の自動付与(S3 の実装)**: ライブラリモジュールの項目・メソッド・struct フィールドに `pub` を自動付与。ただし `impl Trait for Type` ブロック内のメソッドは除外(Rust では `pub` 不可のため)
- **依存指定**: 任意の `.ttm` 内の `#dep name version` 行が `Cargo.toml` の `[dependencies]` になる
- `Cargo.toml` を自動生成(名前はディレクトリ名から)

## 検証

3モジュールのデモ(model = struct + Display 実装 / storage = ファイル I/O / main = CLI)で:

1. `tatamuc --project` → 4ファイル生成
2. `cargo check` → **一発成功**(トレイト実装込みの pub 自動付与も正しく動作)
3. `cargo run` → 正しい実行結果(`hammer x3 = 37.50` … `total = 62.50`)

生成された main.rs の冒頭(mod 宣言と use が自動):

```rust
mod model;
mod storage;
use crate::model::*;
use crate::storage::*;

use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
```

## 制約・今後

- クロスモジュール解決は名前ベースのヒューリスティック(同名項目が複数モジュールにあると曖昧)。実害が出たら「モジュール名を明示するパス記法」を仕様に足す
- 外部クレートの検証は未実施(このサンドボックスは crates.io に出られないため)。`#dep` の Cargo.toml 生成までは確認済み
- ネストしたモジュール階層(サブディレクトリ)は未対応
- モバイル/wasm 要件(00-concept)は cargo が入ったことで `cargo build --target wasm32-*` / staticlib 化への道が開けた — 実測は次の段階
