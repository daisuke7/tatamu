# Stage 2-2: LLM 向け診断 実装レポート

> 2026-08-17 実施。`tatamuc --check <file.ttm>` として実装(`transpiler/tatamuc.mjs` の `diagnose()`)。

## 設計方針

00-concept のリスク①対策 (b)「エラーメッセージを LLM 向けに設計し、フィードバックループで修正させる」の最初の実装。方針:

- **構造化 JSON** — `{line, rule, severity, message, found, suggestion}` の配列。LLM がパースせず読める
- **suggestion は「直した行そのもの」** — 「〜してください」ではなく `Write: fn area(r: f64) f64 {` のようにコピペ可能な修正形を返す
- **severity 3段階** — error(変換不能/不正)、warning(無駄だが変換可)、info(寛容モードで吸収済み)

## 検出ルール

| rule | severity | 検出対象 |
|---|---|---|
| no-use-lines | error | `use` 行(自動解決されるため不要) |
| no-let-binding | error | `let` 束縛(`if let` / `while let` は除外)。`:=` 形式への書き換えを提示 |
| mut-binding-needs-walrus | error | `mut x = expr`(束縛でも再代入でもない曖昧形)。**第1ラウンドで Opus が実際に出したバグ** |
| no-arrow | error | シグネチャの `->` |
| derive-shorthand | error | `#[derive(...)]` 属性 → `+List` へのマージ形を提示 |
| no-pub | error | `pub` キーワード |
| unbalanced-delimiters | error | 括弧の不平衡 |
| no-indentation | warning | 行頭空白 |
| trailing-semicolon | info | 行末 `;`(寛容モードで吸収) |

## 検証

- **実バグの検出**: 第1ラウンドで Opus が生成した重複行(`mut stack = Vec::new()`)を `mut-binding-needs-walrus` が正しく検出し、「束縛なら `mut stack := Vec::new()`、再代入なら `stack = Vec::new()`」の二択を提示できた
- **違反まみれの入力**: 第1ラウンド Haiku の出力に対し、trailing-semicolon 等の診断を網羅的に出力
- **誤検知ゼロ**: v0.2 の全24プログラム(コンパイル成功済み)に対し error 診断 0 件
- **合成テスト**: 全9ルールを含む不正ファイルで、各ルールが期待どおり発火することを確認

## 想定ワークフロー

```
LLM 生成 → tatamuc --check(JSON 診断)→ エラーあれば診断を LLM に返して再生成 → tatamuc 変換 → rustc
```

v0.2/v0.3 実験では一発通過率が 100% だったため実運用でループが回る頻度は低い見込みだが、より難しいドメインや弱いモデルでの保険として機能する。診断は Tatamu 層のみを対象とし、型エラー等は rustc のエラー(将来的に Tatamu の行番号へマップし直すのが Stage 2 の残課題)に委ねる。
