# v0.6: 仕様 14.4「現状の制限」の全解消レポート

> 2026-08-18 実施。[tatamu-spec.md](tatamu-spec.md) §14.4 に列挙していた制限を一括解消し、仕様を v0.6 に更新。

## 解消した項目

### 1. 可視性 — `priv` 前置キーワード

`priv` を項目(fn / struct / enum / trait / const / impl メソッド)とフィールドに前置すると、展開時に `pub` が付かない(= Rust のモジュールプライベート)。

```
priv fn helper() u8 {1}
struct S {priv secret u8, open u8}
```

- 実装: transpileMapped が priv 行を追跡し、pubify が該当行をスキップ。単一行/複数行 struct のフィールド単位にも対応
- 検証: buildProject 出力で `pub fn open_fn` / 非 pub `fn helper` / `pub open` / 非 pub `secret` を確認、cargo run 通過
- これにより 14.1 対照表の可視性は「意味論の差」から「構文の差(デフォルトの反転)」に変わり、**Tatamu と Rust の意味論的差異は正式にゼロ**になった

### 2. サブディレクトリのモジュール階層

`--project` / `--compile` がディレクトリを再帰走査し、`net/http.ttm` → `crate::net::http` を生成する。中間モジュール(`src/net.rs`)は自動合成(自前の `net.ttm` があればそこに子宣言を追記)。クロスモジュール自動解決もネストパス(`use crate::net::http::*;`)で機能。

- 検証: `net/http` + `util/text`(priv 込み)+ `main` の3層プロジェクトが --compile ok → cargo run で正しい出力

### 3. `macro_rules!` 定義

セミコロン挿入にマクロ文脈(`macro-rules` / `macro-arm`)を追加。単一行アームの `};`、複数行アームの閉じ `};` を正しく生成する。

- **面白い副産物: マクロ本体の中も Tatamu 記法で書ける**(`v := $msg` → `let v = $msg;`)— 行単位のテキスト変換だからこそで、AST ベースなら意図的な対応が要る部分
- 検証: 2アーム構成(単一行+複数行、`$expr` 引数)のマクロ定義+呼び出しが rustc 通過・実行成功

### 4. データ enum の explicit discriminant

`enum Msg {Ping = 10, Data {x f64} = 20}` を parseCAbi が解釈し、FFI バインディングのタグ値(JS `tags` / C `Msg_Ping = 10`)に反映。

- 実装過程で Rust 側の要件を確認: データ付き variant への判別子には **`#[repr(C, i32)]` のような整数型併記が必須**(E0732)。仕様に明記し、バインディングは 32bit タグのみ対応(それ以外の幅は警告してスキップ)

### 5. async — docs/26 で解消済みの反映

tokio 実証(26)を受けて 14.4 から削除し、「Rust のまま」領域の明文リストに `async`/`.await`/`select!` を追加。

## 14.4 の新しい姿

「制限」は空になり、**意図的な非対応**のみが残る:

- インラインコメント(設計: サイドカーが正式な置き場、`no-comments` 診断が誘導)
- FFI でのジェネリック型・可変長ネスト型(C ABI の性質。Rust の extern "C" でも同じ — モノモーフィックなラッパが正道)
- FFI データ enum タグの 32bit 限定

## 検証

- ユニットコーパス **83/83**(priv ×2、macro ×2、async 引数位置ブロック、ネスト ×2、判別子 ×1 を新規追加)
- サニティ 29/29、生成コーパス 48本コンパイル、mdlite / cargo-project の --compile ok
- 仕様書 v0.6・LLM 常駐プロンプトの両方を更新済み
