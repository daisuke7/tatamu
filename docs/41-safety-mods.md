# SAFETY 級改修実験: 契約はコードの隣接パターンが運ぶ — stripped でも危険な改修は発生しなかった

> 2026-08-21 実施。docs/40 の残課題「SAFETY 級知識が正否を分ける改修課題」。
> ハーネス: `experiments/safety-mods/`(run.mjs / tasks.mjs / sanity.mjs)。総コスト ≈ $6。

## 1. 設計 — 「違反を機械検出できる」3課題

UB はビルド+実行では見えないため、**違反検出器を課題ごとに設計**し、既知の間違い実装が
意図したゲートで落ちることを sanity で事前検証した(8ケース、全 SANE):

| 課題 | 内容 | 危険な知識(外部化コメントの所在) | 検出器 |
|---|---|---|---|
| T1 | `OnceNonZeroU32` を AtomicU32 で**直接**実装(委譲禁止) | モジュール docs の Acquire/Release 保証 | 生成コードの ordering 引数を括弧スパン単位でスキャン(Relaxed 級→fail) |
| T2 | `imp_std::OnceCell::is_running()` 追加 | 「状態は下位2bit、残りは waiter ポインタ」 | grader 所有のテストを imp_std.rs 末尾に注入し cargo test — **waiter を実際に積んで** naive な `== RUNNING` 比較を落とす |
| T3 | `OnceBox::get_or_init_value(Box<T>)` を単一 CAS で直接実装 | CAS 敗者の解放義務+failure ordering=Acquire の根拠 | Drop カウンタ fixture(リーク/二重解放)+ CAS failure ordering スキャン |

- fix ラウンドは**ビルドエラーのみ**(挙動・契約違反は即終了、フィードバックは
  「documented contract に違反」とだけ伝え正解を教えない)
- 条件: blind / lens(docs/40 §6 の fetch-first 文言)/ full × Haiku/Sonnet = 18ラン

## 2. 結果 — 全条件・全モデル 3/3 成功、契約違反ゼロ

| | blind | lens | full |
|---|---|---|---|
| Haiku | 3/3 | 3/3(notes 4/0/2) | 3/3 |
| Sonnet | 3/3 | 3/3(notes 9/9/4) | 3/3 |

全て最初の機能的試行で合格(fix ラウンド消費ゼロ)。blind — コメント無し・サイドカーの存在も
知らない条件 — ですら、Relaxed 実装も naive 比較もリークも一度も出なかった。

## 3. 解釈 — なぜ「知識が正否を分け」なかったか

**危険な契約は、コメントではなく隣接コードの実装パターン自体に刻まれている。**
ordering は `Ordering::Release, Ordering::Acquire` というコードとして OnceNonZeroUsize の実装に
見えており、状態マスクは `strict::addr(q) & STATE_MASK` として、CAS 敗者の解放は init() の
`drop(Box::from_raw(ptr))` として見えている。モデル(Haiku 含む)は改修時に隣接実装を注意深く
模倣するので、コメントを externalize しても危険な改修は誘発されなかった。両モデルとも
once_cell 本家と同じ設計(プライベート `compare_exchange` ヘルパ)を自発的に再現したほどである。

これは docs/40 の理解実験と綺麗に相補する:
- **改修(パターン追従)**: 契約はコードが運ぶ → stripped で安全性は劣化しない(本実験)
- **理解(設計判断の why)**: 「やらない理由」「API を作らない理由」はコードに痕跡が無い
  → コメント(=サイドカー)だけが担う(docs/40 の d3/d4/d8)

つまり (a) パスの安全性リスクは「よく書かれた既存実装が隣にある改修」では実測ゼロで、
残るリスクは「隣に模倣対象が無い新規設計」に局在する — これはコメントの有無以前に
難しいタスクであり、lens の notes(why の取得)がまさに効く領域である。

なお sonnet/lens は fetch-first 文言に従い計22回 notes を参照した上で全問正解 — 参照コストは
$1.74 vs full $1.76 で同額以下。安全マージンとしての「引いてから書く」は無料で足せる。

## 4. ハーネスの学び(また判定器が先に間違えた)

初回は T1 が**全条件全滅**に見えたが、原因は判定器:モデルが本家と同じ「プライベート
`compare_exchange` ヘルパ」を書き、スキャナがヘルパ呼び出し(ordering 引数なし)を生 CAS と
誤認していた。**括弧スパン内の Ordering トークンのみ検査**に修正し、保存済み生成物を再判定
(6/6 が実は正解)。「full 込みで全滅したらモデルでなく判定器を疑え」は docs/40 に続き2度目の教訓。

## 5. 限界

- 3課題とも「隣接に正しい実装パターンが存在する」設定 — 模倣不能な新規設計課題は未測定
  (once_cell 内では構成困難。別クレートか合成コードベースが必要)
- ordering スキャンは変数渡しの ordering を追えない(今回は全て直書きで問題なし)
- T2 の waiter テストは 400ms のタイミング余裕に依存(実測で安定)
