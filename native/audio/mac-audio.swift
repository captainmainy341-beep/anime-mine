import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

func fail(_ message: String, code: Int32 = 2) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func pcm16(_ sampleBuffer: CMSampleBuffer) -> Data? {
    guard let format = CMSampleBufferGetFormatDescription(sampleBuffer),
          let description = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee else { return nil }
    let frames = CMSampleBufferGetNumSamples(sampleBuffer)
    let isFloat = description.mFormatFlags & kAudioFormatFlagIsFloat != 0
    let bytesPerSample = Int(description.mBitsPerChannel / 8)
    guard frames > 0, (isFloat && bytesPerSample == 4) || (!isFloat && bytesPerSample == 2) else { return nil }

    var sizeNeeded = 0
    _ = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer,
        bufferListSizeNeededOut: &sizeNeeded,
        bufferListOut: nil,
        bufferListSize: 0,
        blockBufferAllocator: nil,
        blockBufferMemoryAllocator: nil,
        flags: 0,
        blockBufferOut: nil
    )
    let storage = UnsafeMutableRawPointer.allocate(byteCount: sizeNeeded, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { storage.deallocate() }
    let list = storage.bindMemory(to: AudioBufferList.self, capacity: 1)
    var blockBuffer: CMBlockBuffer?
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer,
        bufferListSizeNeededOut: nil,
        bufferListOut: list,
        bufferListSize: sizeNeeded,
        blockBufferAllocator: nil,
        blockBufferMemoryAllocator: nil,
        flags: 0,
        blockBufferOut: &blockBuffer
    )
    guard status == noErr else { return nil }

    return withExtendedLifetime(blockBuffer) { () -> Data? in
        var sums = [Float](repeating: 0, count: frames)
        var channels = 0
        for buffer in UnsafeMutableAudioBufferListPointer(list) {
            guard let data = buffer.mData else { continue }
            let perFrame = max(1, Int(buffer.mNumberChannels))
            channels += perFrame
            for i in 0..<(Int(buffer.mDataByteSize) / bytesPerSample) {
                let frame = i / perFrame
                guard frame < frames else { break }
                sums[frame] += isFloat
                    ? data.loadUnaligned(fromByteOffset: i * 4, as: Float.self)
                    : Float(data.loadUnaligned(fromByteOffset: i * 2, as: Int16.self)) / 32768
            }
        }
        guard channels > 0 else { return nil }

        var out = Data(count: frames * 2)
        out.withUnsafeMutableBytes { raw in
            for frame in 0..<frames {
                let value = max(-1, min(1, sums[frame] / Float(channels)))
                raw.storeBytes(of: Int16((value * 32767).rounded()).littleEndian, toByteOffset: frame * 2, as: Int16.self)
            }
        }
        return out
    }
}

final class AudioSink: NSObject, SCStreamOutput, SCStreamDelegate {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let pcm = pcm16(sampleBuffer) else { return }
        do {
            try FileHandle.standardOutput.write(contentsOf: pcm)
        } catch {
            exit(0)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        fail("audio capture stopped: \(error.localizedDescription)")
    }
}

signal(SIGPIPE, SIG_IGN)

let sink = AudioSink()
let sampleQueue = DispatchQueue(label: "mac-audio.samples")
var captureStream: SCStream?

Task {
    do {
        let content = try await SCShareableContent.current
        guard let display = content.displays.first else { fail("no display available for audio capture") }

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 24000
        config.channelCount = 1
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: config, delegate: sink)
        try stream.addStreamOutput(sink, type: .audio, sampleHandlerQueue: sampleQueue)
        try await stream.startCapture()
        captureStream = stream
    } catch {
        fail("system audio capture unavailable (check Screen Recording permission): \(error.localizedDescription)")
    }
}

DispatchQueue.global().async {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    exit(0)
}

dispatchMain()
