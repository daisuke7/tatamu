import 'dart:ffi';
import 'mdlite.dart';

void main() {
  final lib = Mdlite.open('/tmp/claude-501/mdlite/target/release/libmdlite.dylib');
  final cases = {
    '# Hi': '<h1>Hi</h1>\n',
    'a **b** and `c`': '<p>a <strong>b</strong> and <code>c</code></p>\n',
    '- x\n- y': '<ul>\n<li>x</li>\n<li>y</li>\n</ul>\n',
    '畳んで*広げる* [link](https://x.dev)':
        '<p>畳んで<em>広げる</em> <a href="https://x.dev">link</a></p>\n',
  };
  var ok = 0;
  cases.forEach((md, want) {
    final s = lib.writeString(md);
    final lenSlot = lib.allocLenSlot();
    final outPtr = lib.md_to_html(s.ptr, s.len, lenSlot);
    final got = lib.takeString(outPtr, lib.readLenSlot(lenSlot));
    lib.freeLenSlot(lenSlot);
    lib.md_free(s.ptr, s.len);
    if (got == want) {
      ok++;
    } else {
      print('MISMATCH: $md\n got: $got\nwant: $want');
    }
  });
  print('$ok/${cases.length} Dart FFI checks passed');
}
