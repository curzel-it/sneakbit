import Foundation
import UIKit

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

    func setWindowSize(_ size: CGSize) {
        self.size = size
        center = CGPoint(x: size.width / 2, y: size.height / 2)
        window_size_changed(Float(size.width), Float(size.height), 1, 1, 1)
    }

    func update(deltaTime: TimeInterval) {
        update_game(Float(deltaTime))

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
        CGRect(
            x: CGFloat(Float(entity.frame.x)),
            y: CGFloat(Float(entity.frame.y)),
            width: CGFloat(Float(entity.frame.width)),
            height: CGFloat(Float(entity.frame.height))
        )
    }
}
