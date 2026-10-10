import AppKit

let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let rect = NSRect(x: 40, y: 40, width: 944, height: 944)
let path = NSBezierPath(roundedRect: rect, xRadius: 210, yRadius: 210)
NSGradient(colors: [NSColor(red: 0.96, green: 0.45, blue: 0.62, alpha: 1), NSColor(red: 0.42, green: 0.25, blue: 0.78, alpha: 1)])!.draw(in: path, angle: -60)
let style = NSMutableParagraphStyle()
style.alignment = .center
let attrs: [NSAttributedString.Key: Any] = [
  .font: NSFont(name: "HiraginoSans-W7", size: 640) ?? NSFont.systemFont(ofSize: 640, weight: .bold),
  .foregroundColor: NSColor.white,
  .paragraphStyle: style,
]
NSAttributedString(string: "読", attributes: attrs).draw(in: NSRect(x: 0, y: 150, width: 1024, height: 720))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
