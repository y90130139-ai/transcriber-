// What is in a frame, on-device, via Apple's Vision framework — the picture
// half of the brief (2026-09-27). The text reader (src/ocr) says what the
// screen says; this says who is in the frame, how big, and what else is there.
//
// Built by setup.sh into vendor/bin/look-frame. No account, no key, no network.
//
// Usage:  look-frame <image> [<image>…]
// Output: one JSON object per line per image:
//   {"path": …, "faces": n, "face": <largest face area, 0-1>,
//    "face_y": <its centre, 0 top – 1 bottom>, "bodies": n,
//    "body": <tallest person's height, 0-1>, "labels": ["horse", …]}
//   A failure prints {"path": …, "error": "load"|"vision"} — a frame nobody
//   can read is an ordinary outcome, not a broken job.

import Foundation
import Vision
import AppKit

// Labels below this are Vision guessing. Tuned on library frames: 0.35 keeps
// "horse", "beach", "car_interior" and drops most texture noise.
let MIN_LABEL: Float = 0.35
let MAX_LABELS = 6

func json(_ object: [String: Any]) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(data: data, encoding: .utf8) ?? "{}"
}

func look(_ path: String) -> String {
    guard let image = NSImage(contentsOfFile: path),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { return json(["path": path, "error": "load"]) }

    let faces = VNDetectFaceRectanglesRequest()
    let bodies = VNDetectHumanRectanglesRequest()
    bodies.upperBodyOnly = false
    let classify = VNClassifyImageRequest()

    do {
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([faces, bodies, classify])
    } catch {
        return json(["path": path, "error": "vision"])
    }

    let faceBoxes = (faces.results ?? []).map { $0.boundingBox }
    let largest = faceBoxes.max { $0.width * $0.height < $1.width * $1.height }
    let bodyBoxes = (bodies.results ?? []).map { $0.boundingBox }
    let tallest = bodyBoxes.map { $0.height }.max() ?? 0
    let labels = (classify.results ?? [])
        .filter { $0.confidence >= MIN_LABEL }
        .sorted { $0.confidence > $1.confidence }
        .prefix(MAX_LABELS)
        .map { $0.identifier }

    return json([
        "path": path,
        "faces": faceBoxes.count,
        "face": largest.map { Double($0.width * $0.height) } ?? 0,
        // Vision's origin is bottom-left; report top-down like the screen.
        "face_y": largest.map { Double(1 - $0.midY) } ?? NSNull(),
        "bodies": bodyBoxes.count,
        "body": Double(tallest),
        "labels": Array(labels),
    ])
}

for path in CommandLine.arguments.dropFirst() {
    print(look(path))
}
