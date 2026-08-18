# Tatamu(畳む)

AI(LLM)がコードを書くことを第一に設計された、Rust への 1:1 トランスパイル言語の PoC。

- **畳む**: Rust より明らかに少ないトークン(実測: 手書き Rust 比 −42.2%)
- **広げる**: `tatamuc` が通常の Rust / cargo プロジェクトに機械展開(意味論は Rust と完全に同一)
- **AI 開発効率 ≧ Rust**: LLM の Rust 知識がそのまま転移するよう、圧縮は機械的に復元可能な省略に限定

```
fn main() R<()> {
text := fs::read_to_string("app.conf")?
mut counts := HashMap::new()
for word in text.split_whitespace() {*counts.entry(word).or_insert(0) += 1}
println!("{counts:?}")
Ok(())
}
```

## ドキュメント

- **[言語仕様(1ファイル統合版・Rust 差異対照表)](docs/tatamu-spec.md)**
- 設計・実験の全記録: [docs/00](docs/00-concept.md)(構想)〜 [docs/26](docs/26-rust2ttm-async.md)(Rust→Tatamu 検討)— 時系列
- LLM 常駐用の圧縮仕様(few-shot 付き): [experiments/llm-generation/prompt-tatamu.md](experiments/llm-generation/prompt-tatamu.md)

## クイックスタート

```sh
node transpiler/tatamuc.mjs file.ttm            # Rust に展開
node transpiler/tatamuc.mjs --check file.ttm    # 構文診断(LLM 向け修正提案付き JSON)
node transpiler/tatamuc.mjs --compile <file|dir># rustc/cargo 型検査 → エラーを .ttm 座標に逆マップ
node transpiler/tatamuc.mjs --project src out   # cargo プロジェクト生成(.rs + .h + .mjs + .d.mts + .dart)

node transpiler/unit-tests.mjs                  # ユニットコーパス(74)
node transpiler/test.mjs                        # サニティコーパス(29)
node transpiler/compile-test.mjs [dir]          # rustc 型検査コーパス(要 Rust)
```

## 構成

| パス | 内容 |
|---|---|
| `transpiler/` | tatamuc(変換・診断・プロジェクト生成・各言語バインディング)、rust2ttm プロトタイプ、テスト |
| `docs/` | 仕様書と全実験レポート(00〜26) |
| `experiments/` | トークン実測、LLM 生成実験、FFI/wasm、外部クレート等の実験一式 |
| `dogfood/` | Tatamu 自身で書いた実プロジェクト: ttmstat(トークン統計 CLI)、mdlite(Markdown→HTML。CLI / wasm ブラウザデモ / Flutter iOS・Android で動作) |

## 検証状況(2026-08-18)

- LLM 生成: 4 Claude モデル × 易6+難6+外部クレート課題、全コンパイル通過・規則違反ゼロ
- ターゲット: CLI / wasm(gzip 17.9KB でブラウザ実行)/ iOS・Android(Flutter 実起動)
- FFI: C 双方向、JS/TS/Dart バインディング自動生成、レイアウトは Rust `offset_of` const assert とパリティ証明
- Rust → Tatamu: プロトタイプで idiomatic Rust 393行 → 変換 → テスト 17/17 通過(−31.4%)
