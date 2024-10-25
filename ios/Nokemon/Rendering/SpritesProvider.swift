import UIKit

protocol SpritesProvider {
    func cgImage(for spriteSheetID: UInt32, textureRect: IntRect) -> CGImage?
}

extension SpritesProvider {
    func cgImage(for entity: RenderableItem) -> CGImage? {
        cgImage(for: entity.sprite_sheet_id, textureRect: entity.texture_rect)
    }
}

class MemCachedSpritesProvider: SpritesProvider {
    private struct CacheKey: Hashable {
        let spriteSheetID: UInt32
        let rect: CGRect
    }

    private var cache = [CacheKey: CGImage]()
    private var spriteSheetFileNames: [UInt32: String]
    private var spriteSheetImages = [UInt32: CGImage]()

    init(spriteSheetFileNames: [UInt32: String]) {
        self.spriteSheetFileNames = spriteSheetFileNames
    }

    func cgImage(for spriteSheetID: UInt32, textureRect: IntRect) -> CGImage? {
        let rect = CGRect(
            x: CGFloat(textureRect.x),
            y: CGFloat(textureRect.y),
            width: CGFloat(textureRect.width),
            height: CGFloat(textureRect.height)
        )
        let cacheKey = CacheKey(spriteSheetID: spriteSheetID, rect: rect)

        // Return cached image if available
        if let cachedImage = cache[cacheKey] {
            return cachedImage
        }

        // Load sprite sheet image
        guard let sheetImage = loadSpriteSheetImage(spriteSheetID: spriteSheetID) else {
            return nil
        }

        // Crop the image based on the texture rectangle
        guard let croppedCGImage = sheetImage.cropping(to: rect) else {
            return nil
        }

        // Cache and return the cropped image
        cache[cacheKey] = croppedCGImage
        return croppedCGImage
    }

    private func loadSpriteSheetImage(spriteSheetID: UInt32) -> CGImage? {
        // Return cached sprite sheet image if available
        if let image = spriteSheetImages[spriteSheetID] {
            return image
        }

        // Load the image from the provided file name
        guard let fileName = spriteSheetFileNames[spriteSheetID],
              let url = Bundle.main.url(forResource: fileName, withExtension: "png"),
              let image = UIImage(contentsOfFile: url.path),
              let cgImage = image.cgImage else {
            return nil
        }

        // Cache and return the sprite sheet image
        spriteSheetImages[spriteSheetID] = cgImage
        return cgImage
    }
}
