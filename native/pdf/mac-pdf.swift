import AppKit
import Foundation
import ImageIO
import PDFKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let usage = "usage: mac-pdf count <pdf> | mac-pdf render <pdf> <pageIndex0> <out.png> <longEdgePx>"
guard CommandLine.arguments.count >= 3 else { fail(usage) }
let url = URL(fileURLWithPath: CommandLine.arguments[2])
guard let document = PDFDocument(url: url), !document.isLocked else {
    fail("cannot read pdf: \(url.path)")
}

switch CommandLine.arguments[1] {
case "count":
    print(document.pageCount)
case "render":
    let args = CommandLine.arguments
    guard args.count == 6, let index = Int(args[3]), let longEdge = Int(args[5]), longEdge > 0 else { fail(usage) }
    guard index >= 0, index < document.pageCount, let page = document.page(at: index) else {
        fail("page out of range: \(index)")
    }

    let box = page.bounds(for: .cropBox)
    let quarterTurns = ((page.rotation % 360) + 360) % 360
    let sideways = quarterTurns == 90 || quarterTurns == 270
    let width = sideways ? box.height : box.width
    let height = sideways ? box.width : box.height
    guard width > 0, height > 0 else { fail("page has no size: \(index)") }

    let scale = CGFloat(longEdge) / max(width, height)
    let pixelWidth = max(1, Int((width * scale).rounded()))
    let pixelHeight = max(1, Int((height * scale).rounded()))
    guard let context = CGContext(
        data: nil,
        width: pixelWidth,
        height: pixelHeight,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else {
        fail("cannot create bitmap \(pixelWidth)x\(pixelHeight)")
    }
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
    context.scaleBy(x: CGFloat(pixelWidth) / width, y: CGFloat(pixelHeight) / height)
    page.draw(with: .cropBox, to: context)

    guard let image = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(
              URL(fileURLWithPath: args[4]) as CFURL, "public.png" as CFString, 1, nil
          ) else {
        fail("cannot create png: \(args[4])")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fail("cannot write png: \(args[4])") }
default:
    fail(usage)
}
