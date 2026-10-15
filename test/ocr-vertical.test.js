const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { OcrEngine } = require('../src/core/ocr');

const PHRASE = '日本語の縦書きテスト';
const darwinMajor = Number(os.release().split('.')[0]);
const supported = process.platform === 'darwin' && darwinMajor >= 25 && spawnSync('which', ['swiftc']).status === 0;

const RENDERER = `import CoreGraphics
import CoreText
import Foundation
import ImageIO

let characters = Array(CommandLine.arguments[1])
let output = CommandLine.arguments[2]
let width = 300
let height = 1100
let fontSize: CGFloat = 90
let top: CGFloat = 80
let step: CGFloat = 95

guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { exit(1) }
context.setFillColor(gray: 1, alpha: 1)
context.fill(CGRect(x: 0, y: 0, width: width, height: height))
let font = CTFontCreateWithName("HiraginoSans-W6" as CFString, fontSize, nil)
let attributes = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: CGColor(gray: 0, alpha: 1)] as CFDictionary
for (index, character) in characters.enumerated() {
    let text = CFAttributedStringCreate(nil, String(character) as CFString, attributes)!
    let line = CTLineCreateWithAttributedString(text)
    let lineWidth = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    context.textPosition = CGPoint(x: (CGFloat(width) - lineWidth) / 2, y: CGFloat(height) - top - CGFloat(index) * step - 80)
    CTLineDraw(line, context)
}
guard let image = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, "public.png" as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(destination, image, nil)
exit(CGImageDestinationFinalize(destination) ? 0 : 1)
`;

function renderVerticalPng(dir, text, png) {
  const source = path.join(dir, 'render.swift');
  const bin = path.join(dir, 'render');
  fs.writeFileSync(source, RENDERER);
  const compiled = spawnSync('swiftc', [source, '-o', bin], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const rendered = spawnSync(bin, [text, png], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr);
}

test('live OCR reads stacked vertical Japanese text on macOS 26+', { skip: !supported && 'requires macOS 26+ with swiftc' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-vertical-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const png = path.join(dir, 'vertical.png');
  renderVerticalPng(dir, PHRASE, png);

  const engine = new OcrEngine({ dataDir: path.join(dir, 'data') });
  const result = await engine.recognize(png);
  const text = result.blocks.map(block => block.text).join('');
  const found = [...PHRASE].filter(character => text.includes(character));
  assert.ok(result.blocks.length >= 1, 'no blocks recognized');
  assert.ok(found.length >= 3, `recognized: ${text}`);
});
