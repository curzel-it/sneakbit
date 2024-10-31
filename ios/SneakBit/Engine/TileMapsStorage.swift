import Foundation
import SwiftUI

protocol TileMapsStorage {
    func store(images: [UIImage], forWorld worldId: UInt32, revision: UInt32)
    func images(forWorld worldId: UInt32, revision: UInt32) -> [UIImage]
}

class TileMapsStorageImpl: TileMapsStorage {
    private var cache: [UInt32: [UIImage]] = [:]

    func store(images: [UIImage], forWorld worldId: UInt32, revision: UInt32) {
        // ...
    }

    func images(forWorld worldId: UInt32, revision: UInt32) -> [UIImage] {
        if let cached = cache[worldId] {
            return cached
        }
        
        let images = (0...BIOME_NUMBER_OF_FRAMES).compactMap { variant in
            let fileName = "\(worldId)-\(variant)"
            let url = Bundle.main.url(forResource: fileName, withExtension: "png", subdirectory: "assets")
            
            if let url {
                return UIImage(contentsOfFile: url.path)?.flipVertically()
            } else {
                return nil
            }
        }
        cache[worldId] = images
        return images
    }
}
