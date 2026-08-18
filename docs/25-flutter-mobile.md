# モバイル統合レポート: Flutter(iOS / Android)× Dart FFI

> 2026-08-18 実施。統合キット: `dogfood/mdlite/flutter-kit/`(生成 Dart バインディング + 組み込み手順)

## 結論

**Tatamu 製 mdlite が Flutter の両プラットフォーム向けバイナリ + 自動生成 Dart バインディングまで揃った。** Dart FFI は C ABI を直接呼ぶため、既存の `.a` / `.h` 資産がそのまま使えた。E2E は macOS ホストの Dart VM で同一バインディング+dylib により **4/4 検証済み**(日本語込み)。

## 成果物(1コマンド `tatamuc --project` + cargo で全て生成)

| 成果物 | 内容 |
|---|---|
| `Mdlite.xcframework` | iOS device(aarch64)+ simulator の staticlib、生成 C ヘッダ同梱 |
| `jniLibs` 用 `.so` ×2 | Android arm64-v8a(472KB)+ x86_64 エミュレータ(456KB) |
| `dart/mdlite.dart` | **`--dartbind`(新規実装)による自動生成 Dart FFI バインディング** — 全 extern fn の `lookupFunction` ペア + 文字列ヘルパ(writeString / takeString / allocLenSlot) |
| `flutter-kit/README.md` | Xcode / jniLibs への配置手順と使用例 |

Rust 側は `rustup target add`(ios ×2 / android ×2)のみで、コード変更ゼロ。Android は NDK 27 の clang をリンカ指定するだけだった。

## 今回の最大の収穫: パック u64 プロトコルの欠陥を実機統合が暴いた

Dart E2E の初回実行が **segfault**。原因は文字列返却の「パック u64(`ptr << 32 | len`)」プロトコル — **wasm32(32bit ポインタ)専用の設計であり、64bit ネイティブではアドレス上位ビットが溢れる**。12 のレポートで「wasm64 移行時は要変更」と注記していたリスクが、wasm64 ではなくモバイル統合で現実化した。

**対処: out-param 方式に統一** — `md_to_html(ptr, len, out_len *mut usize) *mut u8`。

- ネイティブ(Dart)・wasm(JS)の両方で同一プロトコルになり、分岐が消えた
- 生成系は全て自動追従(C ヘッダ・Dart・JS・.d.mts)。ブラウザデモも更新し smoke 済み
- Dart バインディング生成からはパック方式ヘルパを削除し、`takeString` / `allocLenSlot` に置換(誤用経路を塞いだ)
- **設計ルール化**: 「ネイティブ FFI に載せる文字列返却は out-param 方式。パック u64 は使わない」(flutter-kit README に明記)

## 検証

- Dart FFI E2E 4/4(見出し / インライン / リスト / 日本語+リンク)
- iOS / Android バイナリのエクスポートシンボル(`md_alloc` / `md_free` / `md_to_html`)を nm / llvm-nm で確認
- プロトコル変更後の全面回帰: cargo test 12/12、ユニット 70/70、サニティ 29/29、wasm ブラウザデモ smoke

## 実機確認(同日追記): シミュレータ/エミュレータで実起動成功

`flutter-kit/flutter-project/` に Flutter アプリ(Markdown 入力 → HTML 出力のライブ変換 UI)を作成し、両プラットフォームで実起動を確認した:

| プラットフォーム | 組み込み方式 | 結果 |
|---|---|---|
| **iOS シミュレータ**(iPhone 16 Pro) | xcconfig の `OTHER_LDFLAGS[sdk=…] -force_load` で device/sim の `.a` を切り替えリンク、`Mdlite.process()` | 起動ログに `mdlite FFI smoke: <h1>Hi from Tatamu</h1>` |
| **Android エミュレータ**(API 36) | `jniLibs/{arm64-v8a,x86_64}/libmdlite.so`(APK 同梱を確認)、`Mdlite.open('libmdlite.so')` | logcat に同ログ |

途中の摩擦1件: Dart の `Pointer<UintPtr>` に `.value` 拡張がなくビルドエラー → バインディング生成に `readLenSlot`(64bit ABI では Uint64 として読む)を追加して解決。

**00-concept のターゲット要件(CLI / モバイル / Web)は、これで3面すべて「実行まで」検証済み。**
