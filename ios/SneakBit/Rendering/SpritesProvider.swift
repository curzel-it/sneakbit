import UIKit

protocol SpritesProvider {
    func cgImage(for spriteSheetID: UInt32, textureRect: FRect) -> CGImage?
}

extension SpritesProvider {
    func cgImage(for entity: RenderableItem) -> CGImage? {
        cgImage(for: entity.sprite_sheet_id, textureRect: entity.texture_rect)
    }
}

class MemCachedSpritesProvider: SpritesProvider {
    private struct CacheKey: Hashable {
        let spriteSheetID: UInt32
        let rect: FRect
    }

    private var cache = [CacheKey: CGImage]()
    private var spriteSheetFileNames: [UInt32: String]
    private var spriteSheetImages = [UInt32: CGImage]()

    init(spriteSheetFileNames: [UInt32: String]) {
        self.spriteSheetFileNames = spriteSheetFileNames
    }

    func cgImage(for spriteSheetID: UInt32, textureRect: FRect) -> CGImage? {
        let cacheKey = CacheKey(spriteSheetID: spriteSheetID, rect: textureRect)

        if let cachedImage = cache[cacheKey] {
            return cachedImage
        }

        guard let sheetImage = loadSpriteSheetImage(spriteSheetID: spriteSheetID) else {
            return nil
        }

        let rect = textureRect.cgRect().scaled(TILE_SIZE)
        guard let croppedCGImage = sheetImage.cropping(to: rect) else {
            return nil
        }

        cache[cacheKey] = croppedCGImage
        return croppedCGImage
    }

    private func loadSpriteSheetImage(spriteSheetID: UInt32) -> CGImage? {
        if let image = spriteSheetImages[spriteSheetID] {
            return image
        }

        guard let fileName = spriteSheetFileNames[spriteSheetID],
              let url = Bundle.main.url(forResource: fileName, withExtension: "png", subdirectory: "assets"),
              let image = UIImage(contentsOfFile: url.path),
              let cgImage = image.cgImage else {
            return nil
        }

        spriteSheetImages[spriteSheetID] = cgImage
        return cgImage
    }
}
