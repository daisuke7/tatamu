# 時系列記録 — 2026-08-17〜08-21 の全経緯(全ドキュメントへのリンク付き)

> 各行は「何をして・何を測り・何を決めたか」。★ = 方針の転換点。
> 全体像は [docs/45-project-overview.md](45-project-overview.md)、転回篇の総括は [docs/44-pivot-summary.md](44-pivot-summary.md)。

## Day 1 — 2026-08-17: 構想から Stage 1 ゲート清算、Stage 2 機能群まで

| doc | 内容 | 主要な測定・決定 |
|---|---|---|
| [00](00-concept.md) | 構想: AI-first な Rust 1:1 方言。段階計画(方言→独自意味論→独自コンパイラ→エコシステム)とゲート条件を事前定義 | ★ 「ゲート未達なら畳む」をここで規定 |
| [01](01-token-analysis.md) | トークン実測 | 外挿でトークン −44〜46% の余地 |
| [02](02-paper-prototype.md) | 紙上文法プロトタイプ | `:=` 束縛・型注釈短縮などの原型 |
| [03](03-llm-generation.md) / [05](05-llm-generation-v2.md) | LLM 生成実験(v0.1→v0.2) | **4モデル 24/24 コンパイル・規則違反ゼロ・−27〜45% → Stage 1 ゲート正式クリア** |
| [04](04-transpiler-mvp.md) | トランスパイラ tatamuc MVP(行ベース Node.js) | |
| [06](06-hard-tasks.md)〜[19](19-data-enums-use.md) | Stage 2 機能群: 難課題 24/24、`--check` 構造化診断、`--project` cargo 生成、doc アウトオブバンド化、rustc エラー逆写像、C ABI/wasm/JS/TS バインディング、ネスト struct/配列/enum レイアウト、外部クレート、doc 鮮度管理、v0.5 | 名称 **Tatamu(畳む)** 決定。crates.io/npm 空き確認 |
| [20](20-dogfooding-1.md) / [21](21-dogfooding-2.md) | ドッグフーディング×2(ttmstat / mdlite) | mdlite 3者比較: **−13.8%(生成 Rust 比)/−42.2%(手書き比)**(tiktoken 測定 — 後に過大と判明) |
| [22](22-mdlite-wasm.md)〜[25](25-flutter-mobile.md) | wasm 化・サイズ最適化・ユニットコーパス・**Flutter iOS/Android 実機** | 構想の3ターゲット(CLI/モバイル/Web)全て実行検証 |

## Day 2 — 2026-08-18: 逆変換と網羅マラソン、そしてゲート実測開始

| doc | 内容 | 主要な測定・決定 |
|---|---|---|
| [26](26-rust2ttm-async.md) | Rust→Tatamu 検討+async 実証 | 既存資産の取り込みが論点化 |
| [27](27-v06-limitations-resolved.md) / [28](28-intentional-gaps-vs-roundtrip.md) | v0.6(制限全解消)/相互変換の弊害検討 | |
| [29](29-comment-ledger.md) | **コメント台帳**(保全・復元、後に AST パスアンカー化) | ★ 後の strip の直系の祖先 |
| [30](30-syn-rust2ttm.md) | syn ベース rust2ttm(Tatamu 製 619 行、ドッグフーディング第3弾) | AST 同値ゲート導入 |
| [31](31-crate-coverage.md) / [32](32-extreme-coverage.md) | 網羅マラソン 33+ ラウンド(コミット履歴に1ラウンド刻みで残存) | **18クレート・約7,900ファイル・約340万行 AST 同値 100%**(残2ファイルは入力側限界) |
| [33](33-prettyplease-issue-drafts.md) | prettyplease 上流バグ報告ドラフト2件 | |
| [34](34-stage2-gate.md) | **Stage 2 ゲート実測①(修正ループ軸)**: .ttm 座標診断 vs 素の rustc、2モデル×4ラン | **判定「未達」**: フロンティア完全同点、小モデルに方言税。「価値は書く瞬間でなく、存在するコードのトークン」 |

## Day 3 — 2026-08-19: 第2軸も未達 → ★転回

| doc | 内容 | 主要な測定・決定 |
|---|---|---|
| [35](35-stage2-context.md) | **ゲート実測②(大規模文脈軸)**: コードベース文脈での理解12問+改修3課題 | **判定「未達」**(正答完全同点)。決定打のアブレーション: once_cell で**コメント外部化 −56% vs 方言 −11%**(Claude トークナイザ実測、旧 −42% は過大) |
| — | ★ **ユーザー決定「(a) で」**: 方言を畳み、コメント外部化を素の Rust に提供 | Fable は費用対効果で除外、実験は Opus まで、の方針もこの前後で確定 |
| [36](36-strip-pivot.md) | `strip`/`restore`/`roundtrip` 実装(純テキスト・コード無再整形・AST 自己検査) | 5コーパス25ファイル: 不動点 25/25、バイト一致 22/25 |
| [37](37-fold-dogfood.md) | ★ **畳みの実行**: 正準ソースを素 Rust クレート `tool/`(バイナリ `tatamu`)へ。**lens**(owners/show/notes)実装=ドッグフーディング第4弾 | 圧縮はコメント密度に比例(once_cell −56% ↔ 自己 −1%)と判明 |

## Day 4 — 2026-08-20: 実クレート硬化と検証実験(前半)

| doc | 内容 | 主要な測定・決定 |
|---|---|---|
| [38](38-subdir-hardening.md) | サブディレクトリ再帰+実クレート硬化。故障9クラス(cfg 双子・多行属性・折返し where・variant フィールド・fn ローカル・macro_rules・URL `/*`・アンカーパース・`*self;`)を roundtrip ゲートが検出→全修正。台帳拡張(`#n` シャドウ・形式/インデント/桁揃えマーカー) | **9コーパス226ファイル: 不動点 226/226、バイト一致 225/226**。フルクレート圧縮 regex-automata −62% |
| [39](39-lens-fresh.md) | **実験① fresh-context**(once_cell、stripped+notes vs full) | 精度全条件パーフェクト。**参照は必要時のみ(コード問 0/8)・的確・full 比 −2割安** |
| [40](40-lens-blind.md) | **実験② ブラインド×大規模**(memchr 45ファイル、blind/lens/full、自由記述 judge 採点) | **lens 11/12 > full 10/12**(Sonnet)。**full は Haiku の 200k に入らない(~205k tok)、stripped は 80k** — fits/doesn't-fit の分水嶺。Haiku は 80k で「引く判断」崩壊 |
| [40 §6](40-lens-blind.md) | 追試: lens 案内の強度だけ変更 | **「まず引け」文言で Haiku 8/12→11/12(Sonnet 同点)**。運用規範確定 |

## Day 5 — 2026-08-21: 検証実験(後半)、完全可逆化、CI、総括

| doc | 内容 | 主要な測定・決定 |
|---|---|---|
| [41](41-safety-mods.md) | **実験③ SAFETY 級改修**(違反を機械検出する3課題: ordering スキャン/waiter 注入テスト/Drop カウンタ) | **blind/lens/full×2モデル 18ラン全合格・違反ゼロ** — 契約は隣接コードのパターンが運ぶ |
| [42](42-novel-design.md) | **実験④ 模倣不能な新規設計**(合成クレート corvid: 仕様は doc のみ・関数は todo!()) | **blind 11〜22% に崩壊(確信を持って非互換実装)、lens は 100% で full と完全同点** — 知識所在マップ完成 |
| [43](43-blockdoc-ci.md) | `/** */` 形式保存(`~ form: block\|inline`)+前書きコメント根治(inline 温存)+統合テスト+GitHub Actions CI | **全10コーパス 231/231 バイト完全一致、既知非一致ゼロ**。CI 常時ゲート化 |
| [44](44-pivot-summary.md) | 転回篇(docs/34〜43)の総括 | 知識所在マップ・方法論5箇条・実験費 ≈$103 |
| [45](45-project-overview.md) / 46(本書) | プロジェクト全体統括/時系列記録 | |

## 転換点だけ抜き出すと

1. **08-17**: ゲート条件の事前定義(docs/00)— 後の全てを可能にした決定
2. **08-18〜19**: 2軸のゲート実測がともに「未達」(docs/34・35)
3. **08-19**: アブレーションが本命(コメント外部化 −56%)を特定 → **ユーザー決定「(a) で」** → 即日で strip 実装・畳み実行(docs/36・37)
4. **08-20〜21**: 実験4本+追試で「サイドカーは従量制になった情報」を全知識クラスで実証(docs/39〜42)
5. **08-21**: 完全可逆(231/231)+CI で製品品質のゲートに到達(docs/43)
