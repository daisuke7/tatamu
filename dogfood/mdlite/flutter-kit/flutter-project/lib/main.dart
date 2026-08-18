import 'dart:io' show Platform;

import 'package:flutter/material.dart';

import 'mdlite.dart';

final mdlite = Platform.isAndroid ? Mdlite.open('libmdlite.so') : Mdlite.process();

String mdToHtml(String md) {
  final s = mdlite.writeString(md);
  final lenSlot = mdlite.allocLenSlot();
  final out = mdlite.md_to_html(s.ptr, s.len, lenSlot);
  final html = mdlite.takeString(out, mdlite.readLenSlot(lenSlot));
  mdlite.freeLenSlot(lenSlot);
  mdlite.md_free(s.ptr, s.len);
  return html;
}

void main() {
  // proves the FFI path before the first frame; visible via `simctl launch --console`
  debugPrint('mdlite FFI smoke: ${mdToHtml("# Hi from Tatamu").trim()}');
  runApp(const MdliteApp());
}

class MdliteApp extends StatelessWidget {
  const MdliteApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'mdlite demo',
      theme: ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true),
      home: const ConverterPage(),
    );
  }
}

class ConverterPage extends StatefulWidget {
  const ConverterPage({super.key});

  @override
  State<ConverterPage> createState() => _ConverterPageState();
}

class _ConverterPageState extends State<ConverterPage> {
  final _controller = TextEditingController(
    text: '# mdlite on Flutter\n\n'
        '**Tatamu** で書いた変換器が *Dart FFI* で動いています。\n\n'
        '- iOS: static lib\n'
        '- Android: libmdlite.so\n\n'
        '> 畳んで小さく、広げて動く。',
  );
  String _html = '';

  @override
  void initState() {
    super.initState();
    _update();
    _controller.addListener(_update);
  }

  void _update() => setState(() => _html = mdToHtml(_controller.text));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('mdlite — Tatamu × Flutter')),
      body: Column(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: TextField(
                controller: _controller,
                maxLines: null,
                expands: true,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  labelText: 'Markdown',
                ),
              ),
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              color: Theme.of(context).colorScheme.surfaceContainerLowest,
              child: SingleChildScrollView(
                child: Text(_html, style: const TextStyle(fontFamily: 'monospace')),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
