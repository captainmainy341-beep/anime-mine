import Foundation
import ImageIO
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

final class Box<T>: @unchecked Sendable {
    var value: T
    init(_ value: T) { self.value = value }
}

#if compiler(>=6.2)
@available(macOS 26.0, *)
func documentBlocks(url: URL, width: Double, height: Double) async throws -> [[String: Any]] {
    let data = try Data(contentsOf: url)
    let observations = try await RecognizeDocumentsRequest().perform(on: data)
    var blocks: [[String: Any]] = []
    for observation in observations {
        for paragraph in observation.document.paragraphs {
            let text = paragraph.transcript.components(separatedBy: .newlines).joined()
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            let box = paragraph.boundingRegion.boundingBox.cgRect
            let pixelWidth = box.width * width
            let pixelHeight = box.height * height
            blocks.append([
                "text": text,
                "box": [
                    "x": box.minX,
                    "y": 1 - box.maxY,
                    "w": box.width,
                    "h": box.height,
                ],
                "vertical": pixelHeight > pixelWidth * 1.5,
                "confidence": 1.0,
            ])
        }
    }
    return blocks
}

@available(macOS 26.0, *)
func documentLines(url: URL, width: Double, height: Double) -> [[String: Any]] {
    let semaphore = DispatchSemaphore(value: 0)
    let result = Box<[[String: Any]]>([])
    Task.detached {
        result.value = (try? await documentBlocks(url: url, width: width, height: height)) ?? []
        semaphore.signal()
    }
    semaphore.wait()
    return result.value
}
#endif

guard CommandLine.arguments.count >= 2 else { fail("usage: mac-ocr <image-path>") }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("cannot read image: \(url.path)")
}

let width = Double(image.width)
let height = Double(image.height)

var lines: [[String: Any]] = []
#if compiler(>=6.2)
if #available(macOS 26.0, *) {
    lines = documentLines(url: url, width: width, height: height)
}
#endif

if lines.isEmpty {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ja-JP"]
    request.usesLanguageCorrection = false

    do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
        fail("vision request failed: \(error.localizedDescription)")
    }

    lines = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        let pixelWidth = box.width * width
        let pixelHeight = box.height * height
        return [
            "text": candidate.string,
            "box": [
                "x": box.minX,
                "y": 1 - box.maxY,
                "w": box.width,
                "h": box.height,
            ],
            "vertical": pixelHeight > pixelWidth * 1.5,
            "confidence": Double(candidate.confidence),
        ]
    }
}

let output: [String: Any] = ["width": width, "height": height, "blocks": lines]
let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
