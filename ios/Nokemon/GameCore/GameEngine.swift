import Foundation
import UIKit
import Schwifty

class GameEngine {
    static let shared = GameEngine()
    
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
    
    private var currentWorldId: UInt32 = 0
    private var lastFpsUpdate: Date = Date()
    private var frameCount: Int = 0
    private var isUpdating: Bool = false
    
    private let tileSize = CGFloat(TILE_SIZE)
    private var renderingScale: CGFloat = 1
    private var cameraViewport: IntRect = .zero
    private var cameraViewportOffset: Vector2d = .zero
    
    private var displayLink: CADisplayLink?
    private var lastUpdateTime: CFTimeInterval = CACurrentMediaTime()
    
    private var keyPressed = Set<EmulatedKey>()
    private var keyDown = Set<EmulatedKey>()
    private var currentChar: UInt32 = 0
    
    private var biomeTiles: [[BiomeTile]] = []
    private var constructionTiles: [[ConstructionTile]] = []
    
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

        update(deltaTime: Float(deltaTime))
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
    
    func fetchTiles() {
        fetchBiomeTiles { tiles in
            self.biomeTiles = tiles.map { row in
                row.map { tile in
                    BiomeTile(with: tile)
                }
            }
        }
        fetchConstructionTiles { tiles in
            self.constructionTiles = tiles.map { row in
                row.map { tile in
                    ConstructionTile(with: tile)
                }
            }
        }
    }
    
    func renderBiomeTiles(_ render: @escaping (Int32, Int32, Int32, Int32) -> Void) {
        guard !biomeTiles.isEmpty else { return }
        
        let rows = current_world_height()
        let cols = current_world_width()
        
        let startRow = min(max(cameraViewport.y - 2, 0), rows)
        let endRow = min(max(cameraViewport.y + cameraViewport.height + 3, 0), rows)
        
        let startCol = min(max(cameraViewport.x - 2, 0), cols)
        let endCol = min(max(cameraViewport.x + cameraViewport.width + 3, 0), cols)
                
        for row in startRow..<endRow {
            for col in startCol..<endCol {
                render(
                    biomeTiles[Int(row)][Int(col)].texture_offset_x,
                    biomeTiles[Int(row)][Int(col)].texture_offset_y,
                    row,
                    col
                )
            }
        }
    }
    
    func renderConstructionTiles(_ render: @escaping (Int32, Int32, Int32, Int32) -> Void) {
        guard !constructionTiles.isEmpty else { return }
        
        let rows = current_world_height()
        let cols = current_world_width()
        
        let startRow = min(max(cameraViewport.y - 2, 0), rows)
        let endRow = min(max(cameraViewport.y + cameraViewport.height + 3, 0), rows)
        
        let startCol = min(max(cameraViewport.x - 2, 0), cols)
        let endCol = min(max(cameraViewport.x + cameraViewport.width + 3, 0), cols)
        
        for row in startRow..<endRow {
            for col in startCol..<endCol {
                render(
                    constructionTiles[Int(row)][Int(col)].texture_source_rect.x,
                    constructionTiles[Int(row)][Int(col)].texture_source_rect.y,
                    row,
                    col
                )
            }
        }
    }

    func setupChanged(windowSize: CGSize, screenScale: CGFloat?) {
        renderingScale = renderingScale(windowSize: windowSize, screenScale: screenScale)
        size = windowSize
        center = CGPoint(x: size.width / 2, y: size.height / 2)
        window_size_changed(
            Float(size.width),
            Float(size.height),
            Float(renderingScale),
            12,
            8
        )
    }
    
    private func renderingScale(windowSize: CGSize, screenScale: CGFloat?) -> CGFloat {
        if UIDevice.current.userInterfaceIdiom == .tv {
            return 3.0
        }
        if UIDevice.current.userInterfaceIdiom == .pad {
            return 2.0
        }
        if (screenScale ?? 0) > 1 {
            return 1.5
        }
        return 1
    }

    func update(deltaTime: Float) {
        updateKeyboardState(timeSinceLastUpdate: deltaTime)
        update_game(deltaTime)
        
        if current_world_id() != currentWorldId {
            currentWorldId = current_world_id()
            fetchTiles()
        }
        
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
    
    func setDidType(char: Character) {
        if let scalar = char.unicodeScalars.first, char.unicodeScalars.count == 1 {
            currentChar = scalar.value
        } else {
            setDidTypeNothing()
        }
    }
    
    func setDidTypeNothing() {
        currentChar = 0
    }
    
    func setKeyDown(_ key: EmulatedKey) {
        if keyPressed.contains(key) {
            keyPressed.remove(key)
        } else {
            keyPressed.insert(key)
        }
        keyDown.insert(key)
    }
    
    func setKeyUp(_ key: EmulatedKey) {
        keyPressed.remove(key)
        keyDown.remove(key)
    }
    
    private func updateKeyboardState(timeSinceLastUpdate: Float) {
        update_keyboard(
            keyPressed.contains(.up),
            keyPressed.contains(.right),
            keyPressed.contains(.down),
            keyPressed.contains(.left),
            keyDown.contains(.up),
            keyDown.contains(.right),
            keyDown.contains(.down),
            keyDown.contains(.left),
            keyPressed.contains(.escape),
            keyPressed.contains(.menu),
            keyPressed.contains(.confirm),
            keyPressed.contains(.attack),
            keyPressed.contains(.backspace),
            currentChar,
            timeSinceLastUpdate
        )
    }
}
