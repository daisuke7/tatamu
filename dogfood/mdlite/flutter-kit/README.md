# mdlite Flutter 統合キット

Tatamu 製 mdlite を Flutter(iOS / Android)から Dart FFI で使うための一式。
`mdlite.dart` は `tatamuc --project` が自動生成した Dart バインディング(コピー)。

## 1. バイナリのビルド

```sh
node transpiler/tatamuc.mjs --project dogfood/mdlite/src-ttm build/mdlite
cd build/mdlite
NDK=~/Library/Android/sdk/ndk/27.2.12479018/toolchains/llvm/prebuilt/darwin-x86_64/bin

# iOS (device + simulator) → XCFramework
cargo build --release --target aarch64-apple-ios
cargo build --release --target aarch64-apple-ios-sim
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/libmdlite.a -headers include \
  -library target/aarch64-apple-ios-sim/release/libmdlite.a -headers include \
  -output Mdlite.xcframework

# Android (arm64 + emulator x86_64)
CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$NDK/aarch64-linux-android24-clang \
  cargo build --release --target aarch64-linux-android
CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER=$NDK/x86_64-linux-android24-clang \
  cargo build --release --target x86_64-linux-android
```

## 2. Flutter プロジェクトへの配置

- `lib/mdlite.dart` ← このディレクトリの `mdlite.dart`
- **iOS**: `Mdlite.xcframework` を Xcode の Runner ターゲットに追加(General → Frameworks, Libraries, and Embedded Content、静的なので Do Not Embed)。呼び出しは `Mdlite.process()`(静的リンクなのでプロセス内シンボル)
- **Android**: `.so` を `android/app/src/main/jniLibs/` へ
  - `jniLibs/arm64-v8a/libmdlite.so` ← `target/aarch64-linux-android/release/`
  - `jniLibs/x86_64/libmdlite.so` ← `target/x86_64-linux-android/release/`(エミュレータ用)
  - 呼び出しは `Mdlite.open('libmdlite.so')`

## 3. 使い方

```dart
import 'mdlite.dart';
import 'dart:io' show Platform;

final lib = Platform.isAndroid ? Mdlite.open('libmdlite.so') : Mdlite.process();

String mdToHtml(String md) {
  final s = lib.writeString(md);
  final lenSlot = lib.allocLenSlot();
  final out = lib.md_to_html(s.ptr, s.len, lenSlot);
  final html = lib.takeString(out, lib.readLenSlot(lenSlot));
  lib.freeLenSlot(lenSlot);
  lib.md_free(s.ptr, s.len);
  return html;
}
```

動作確認済み(2026-08-18):

- macOS ホスト Dart VM: E2E 4/4(`example_main.dart`)
- **iOS シミュレータ(iPhone 16 Pro)**: `flutter build ios --simulator` → 実起動 → ログに `mdlite FFI smoke: <h1>Hi from Tatamu</h1>`
- **Android エミュレータ(API 36, arm64)**: `flutter build apk --debug`(.so 2 ABI 同梱確認)→ 実起動 → logcat に同ログ

実機サンプルアプリは `flutter-project/`(左 Markdown 入力・下 HTML 出力のライブ変換 UI)。

## 文字列プロトコルの注意

戻り値文字列は **out-param 方式**(`out_len *mut usize` + 戻り値 `*mut u8`)。
パック u64 方式(`ptr << 32 | len`)は **wasm32 専用** — 64bit ネイティブではポインタが収まらない(実際に segfault で発見)。ネイティブ FFI に載せる関数は必ず out-param 方式にすること。
