// On-device OCR for burned-in reel text, via Apple's Vision framework.
//
// Built by setup.sh into vendor/bin/ocr-text. No account, no API key, no
// network: the same constitution as the rest of the toolchain, and the reason
// this is worth having at all is that ~29% of the local corpus never speaks,
// so the text stamped on the frame is the only hook signal those videos carry.
//
// Usage:  ocr-text <image> [<image>…]
// Output: one TSV line per image — <path>\t<text, lines joined by " | ">
//         An image with no readable text prints an empty second field.
//         A failure prints ERR_LOAD / ERR_VISION rather than exiting non-zero:
//         a video nobody can read is an ordinary outcome, not a broken job.

import Foundation
import Vision
import AppKit

// Below this, Vision is guessing at shapes rather than reading letters. Tuned
// against the library sample: 0.4 kept every real hook and dropped most of the
// stylised-watermark noise.
let MIN_CONFIDENCE: Float = 0.4

func recognise(_ path: String) -> String {
    guard let image = NSImage(contentsOfFile: path),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { return "ERR_LOAD" }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]

    do {
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    } catch {
        return "ERR_VISION"
    }

    let lines = (request.results ?? []).compactMap { observation -> String? in
        guard let best = observation.topCandidates(1).first,
              best.confidence >= MIN_CONFIDENCE else { return nil }
        let text = best.string.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }
    return lines.joined(separator: " | ")
}

for path in CommandLine.arguments.dropFirst() {
    // Tabs and newlines inside recognised text would corrupt the TSV contract.
    let text = recognise(path)
        .replacingOccurrences(of: "\t", with: " ")
        .replacingOccurrences(of: "\n", with: " ")
    print("\(path)\t\(text)")
}
