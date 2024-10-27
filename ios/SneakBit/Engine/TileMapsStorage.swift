import Foundation
import SwiftUI

protocol TileMapsStorage {
    func store(images: [UIImage], forWorld worldId: UInt32, revision: UInt32)
    func images(forWorld worldId: UInt32, revision: UInt32) -> [UIImage]
}

class TileMapsStorageImpl: TileMapsStorage {
    private let fileManager: FileManager = .default
    private let storageDirectory: URL

    init() {
        if let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first {
            storageDirectory = caches.appendingPathComponent("TileMaps", isDirectory: true)
        } else {
            storageDirectory = fileManager.temporaryDirectory.appendingPathComponent("TileMaps", isDirectory: true)
        }
        try? fileManager.createDirectory(at: storageDirectory, withIntermediateDirectories: true, attributes: nil)
    }

    func store(images: [UIImage], forWorld worldId: UInt32, revision: UInt32) {
        images.enumerated().forEach { (variant, image) in
            let filename = "\(worldId)-\(revision)-\(variant).png"
            let fileURL = storageDirectory.appendingPathComponent(filename)
            if let pngData = image.pngData() {
                try? pngData.write(to: fileURL, options: .atomic)
            }
        }
    }

    func images(forWorld worldId: UInt32, revision: UInt32) -> [UIImage] {
        (0...BIOME_NUMBER_OF_FRAMES).compactMap { variant in
            let filename = "\(worldId)-\(revision)-\(variant).png"
            let fileURL = storageDirectory.appendingPathComponent(filename)
            return UIImage(contentsOfFile: fileURL.path)
        }
    }
}
