import Foundation
import SwiftUI

protocol TileMapImageGenerator {
    func generate(
        renderingScale: CGFloat,
        worldWidth: Int,
        worldHeight: Int,
        variant: Int32,
        biomeTiles: [[BiomeTile]],
        constructionTiles: [[ConstructionTile]]
    ) -> UIImage?
}

class TileMapImageGeneratorImpl: TileMapImageGenerator {
    @Inject private var spritesProvider: SpritesProvider
    
    private let numberOfBiomes: Int32 = 18
    
    func generate(
        renderingScale: CGFloat,
        worldWidth: Int,
        worldHeight: Int,
        variant: Int32,
        biomeTiles: [[BiomeTile]],
        constructionTiles: [[ConstructionTile]]
    ) -> UIImage? {
        guard !biomeTiles.isEmpty, !constructionTiles.isEmpty else { return nil }
        
        let tileSize = CGFloat(TILE_SIZE) 
        let mapWidth = CGFloat(worldWidth) * tileSize
        let mapHeight = CGFloat(worldHeight) * tileSize
        
        UIGraphicsBeginImageContextWithOptions(CGSize(width: mapWidth, height: mapHeight), false, 1.0)
        guard let context = UIGraphicsGetCurrentContext() else { return nil }
        context.interpolationQuality = .none
        
        for row in 0..<worldHeight {
            for col in 0..<worldWidth {
                let biomeTile = biomeTiles[Int(row)][Int(col)]
                guard biomeTile.tile_type != 0 else { continue }
                
                let textureRect = IntRect(
                    x: biomeTile.texture_offset_x,
                    y: biomeTile.texture_offset_y + variant * numberOfBiomes,
                    w: 1,
                    h: 1
                )
                
                if let image = spritesProvider.cgImage(for: UInt32(SPRITE_SHEET_BIOME_TILES), textureRect: textureRect) {
                    let frame = CGRect(
                        x: CGFloat(col) * tileSize,
                        y: CGFloat(row) * tileSize,
                        width: tileSize,
                        height: tileSize
                    )
                    renderTileImage(image, in: frame, context: context)
                }
            }
        }
        
        for row in 0..<worldHeight {
            for col in 0..<worldWidth {
                let constructionTile = constructionTiles[Int(row)][Int(col)]
                guard constructionTile.tile_type != 0 else { continue }
                
                if constructionTile.texture_source_rect.x != 0 {
                    let textureRect = IntRect(
                        x: constructionTile.texture_source_rect.x,
                        y: constructionTile.texture_source_rect.y,
                        w: 1,
                        h: 1
                    )
                    
                    if let image = spritesProvider.cgImage(for: UInt32(SPRITE_SHEET_CONSTRUCTION_TILES), textureRect: textureRect) {
                        let frame = CGRect(
                            x: CGFloat(col) * tileSize,
                            y: CGFloat(row) * tileSize,
                            width: tileSize,
                            height: tileSize
                        )
                        renderTileImage(image, in: frame, context: context)
                    }
                }
            }
        }
        
        let composedImage = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        
        return composedImage?.flipVertically()
    }
    
    private func renderTileImage(_ image: CGImage, in frame: CGRect, context: CGContext) {
        context.saveGState()
        context.translateBy(x: frame.origin.x, y: frame.origin.y)
        context.scaleBy(x: 1.0, y: -1.0)
        context.translateBy(x: 0, y: -frame.size.height)
        context.draw(image, in: CGRect(origin: .zero, size: frame.size))
        context.restoreGState()
    }
}
