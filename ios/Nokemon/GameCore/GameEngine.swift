import Foundation
import UIKit
import Schwifty

class GameEngine {
    var onNewFrame: () -> Void = {}
    var size: CGSize = .zero
    var center: CGPoint = .zero
    var fps: Double = 0.0
    
    let spritesProvider: SpritesProvider = MemCachedSpritesProvider(
        spriteSheetFileNames: [
            UInt32(SPRITE_SHEET_INVENTORY): "inventory",
            UInt32(SPRITE_SHEET_BIOME_TILES): "tiles_biome",
            UInt32(SPRITE_SHEET_CONSTRUCTION_TILES): "tiles_constructions",
            UInt32(SPRITE_SHEET_BUILDINGS): "buildings",
            UInt32(SPRITE_SHEET_BASE_ATTACK): "baseattack",
            UInt32(SPRITE_SHEET_STATIC_OBJECTS): "static_objects",
            UInt32(SPRITE_SHEET_MENU): "menu",
            UInt32(SPRITE_SHEET_ANIMATED_OBJECTS): "animated_objects",
            UInt32(SPRITE_SHEET_HUMANOIDS_1X1): "humanoids_1x1",
            UInt32(SPRITE_SHEET_HUMANOIDS_1X2): "humanoids_1x2",
            UInt32(SPRITE_SHEET_HUMANOIDS_2X2): "humanoids_2x2",
            UInt32(SPRITE_SHEET_HUMANOIDS_2X3): "humanoids_2x3",
            UInt32(SPRITE_SHEET_AVATARS): "avatars",
            UInt32(SPRITE_SHEET_FARM_PLANTS): "farm_plants"
        ]
    )
    
    private var lastFpsUpdate: Date = Date()
    private var frameCount: Int = 0
    private var isUpdating: Bool = false
    
    private let tileSize = CGFloat(TILE_SIZE)
    private var renderingScale: CGFloat = 1 // = UIScreen.main.scale
    private var cameraViewport: IntRect = .zero
    private var cameraViewportOffset: Vector2d = .zero
    
    private var displayLink: CADisplayLink?
    private var lastUpdateTime: CFTimeInterval = CACurrentMediaTime()
    
    init() {
        initializeEngine()
        displayLink = CADisplayLink(target: self, selector: #selector(gameLoop))
        displayLink?.add(to: .main, forMode: .default)
    }

    deinit {
        displayLink?.invalidate()
    }

    @objc private func gameLoop() {
        guard !isUpdating else { return }
        isUpdating = true
        let currentTime = displayLink?.timestamp ?? CACurrentMediaTime()
        let deltaTime = min(currentTime - lastUpdateTime, 0.05)
        lastUpdateTime = currentTime

        update(deltaTime: deltaTime)
        onNewFrame()
        isUpdating = false
    }
    
    func renderEntities(_ render: @escaping (RenderableItem) -> Void) {
        fetchRenderableItems { items in
            items.forEach { item in
                render(item)
            }
        }
    }
    
    func renderBiomeTiles(_ render: @escaping (Int32, Int32, Int32, Int32) -> Void) {
        let rows = current_world_height()
        let cols = current_world_width()
        
        let startRow = min(max(cameraViewport.y - 2, 0), rows)
        let endRow = min(max(cameraViewport.y + cameraViewport.height + 3, 0), rows)
        
        let startCol = min(max(cameraViewport.x - 2, 0), cols)
        let endCol = min(max(cameraViewport.x + cameraViewport.width + 3, 0), cols)
                
        fetchBiomeTiles { tiles in
            for row in startRow..<endRow {
                for col in startCol..<endCol {
                    render(
                        tiles[Int(row)][Int(col)].texture_offset_x,
                        tiles[Int(row)][Int(col)].texture_offset_y,
                        row,
                        col
                    )
                }
            }
        }
    }
    
    func renderConstructionTiles(_ render: @escaping (Int32, Int32, Int32, Int32) -> Void) {
        let rows = current_world_height()
        let cols = current_world_width()
        
        let startRow = min(max(cameraViewport.y - 2, 0), rows)
        let endRow = min(max(cameraViewport.y + cameraViewport.height + 3, 0), rows)
        
        let startCol = min(max(cameraViewport.x - 2, 0), cols)
        let endCol = min(max(cameraViewport.x + cameraViewport.width + 3, 0), cols)
        
        fetchConstructionTiles { tiles in
            for row in startRow..<endRow {
                for col in startCol..<endCol {
                    render(
                        tiles[Int(row)][Int(col)].texture_source_rect.x,
                        tiles[Int(row)][Int(col)].texture_source_rect.y,
                        row,
                        col
                    )
                }
            }
        }
    }

    func setupChanged(windowSize: CGSize, scale: CGFloat) {
        renderingScale = scale
        size = windowSize
        center = CGPoint(x: size.width / 2, y: size.height / 2)
        window_size_changed(Float(size.width), Float(size.height), 1, 1, 1)
    }

    func update(deltaTime: TimeInterval) {
        update_game(Float(deltaTime))
        let cv = camera_viewport()
        cameraViewport = IntRect(x: cv.x, y: cv.y, width: cv.w, height: cv.h)
        
        let cvo = camera_viewport_offset()
        cameraViewportOffset = Vector2d(x: cvo.x, y: cvo.y)

        frameCount += 1
        let now = Date()
        let elapsed = now.timeIntervalSince(lastFpsUpdate)
        if elapsed >= 1.0 {
            fps = Double(frameCount) / elapsed
            frameCount = 0
            lastFpsUpdate = now
        }
    }
    
    func renderingFrame(for entity: RenderableItem) -> CGRect {
        renderingFrame(for: entity.frame, offset: entity.offset)
    }
    
    func renderingFrame(for frame: IntRect, offset: Vector2d = .zero) -> CGRect {
        let actualCol = CGFloat(frame.x - cameraViewport.x)
        let actualOffsetX = CGFloat(offset.x - cameraViewportOffset.x)

        let actualRow = CGFloat(frame.y - cameraViewport.y)
        let actualOffsetY = CGFloat(offset.y - cameraViewportOffset.y)
        
        return CGRect(
            x: (actualCol * tileSize + actualOffsetX) * renderingScale,
            y: (actualRow * tileSize + actualOffsetY) * renderingScale,
            width: CGFloat(frame.width) * tileSize * renderingScale,
            height: CGFloat(frame.height) * tileSize * renderingScale
        )
    }
}



