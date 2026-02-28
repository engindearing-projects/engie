#!/usr/bin/env swift

// OCR helper using macOS Vision framework.
// Usage: ocr <image_path>
// Output: JSON array of recognized text with bounding boxes.

import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else {
    let error = ["error": "Usage: ocr <image_path>"]
    let data = try! JSONSerialization.data(withJSONObject: error)
    FileHandle.standardOutput.write(data)
    exit(1)
}

let imagePath = CommandLine.arguments[1]
let imageURL = URL(fileURLWithPath: imagePath)

guard let image = NSImage(contentsOf: imageURL),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    let error = ["error": "Failed to load image: \(imagePath)"]
    let data = try! JSONSerialization.data(withJSONObject: error)
    FileHandle.standardOutput.write(data)
    exit(1)
}

let imageWidth = CGFloat(cgImage.width)
let imageHeight = CGFloat(cgImage.height)

let semaphore = DispatchSemaphore(value: 0)
var results: [[String: Any]] = []

let request = VNRecognizeTextRequest { request, error in
    defer { semaphore.signal() }

    if let error = error {
        let errorResult: [String: Any] = ["error": error.localizedDescription]
        let data = try! JSONSerialization.data(withJSONObject: errorResult)
        FileHandle.standardOutput.write(data)
        return
    }

    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }

    for observation in observations {
        guard let candidate = observation.topCandidates(1).first else { continue }

        // Vision bounding boxes are normalized (0-1) with origin at bottom-left.
        // Convert to pixel coordinates with origin at top-left.
        let box = observation.boundingBox
        let x = box.origin.x * imageWidth
        let y = (1.0 - box.origin.y - box.size.height) * imageHeight
        let w = box.size.width * imageWidth
        let h = box.size.height * imageHeight

        results.append([
            "text": candidate.string,
            "confidence": candidate.confidence,
            "x": Int(x),
            "y": Int(y),
            "width": Int(w),
            "height": Int(h),
        ])
    }
}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    let errorResult: [String: Any] = ["error": error.localizedDescription]
    let data = try! JSONSerialization.data(withJSONObject: errorResult)
    FileHandle.standardOutput.write(data)
    exit(1)
}

semaphore.wait()

let data = try! JSONSerialization.data(withJSONObject: results, options: .prettyPrinted)
FileHandle.standardOutput.write(data)
