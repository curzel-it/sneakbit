import Foundation
import UIKit
import Schwifty

class GameEngine {
    @Inject private var renderingScaleUseCase: RenderingScaleUseCase
    @Inject private var tileMapImageGenerator: TileMapImageGenerator
    @Inject private var spritesProvider: SpritesProvider
    
    var size: CGSize = .zero
    var fps: Double = 0.0
    
    private var currentWorldId: UInt32 = 0
    private var lastFpsUpdate: Date = Date()
    private var frameCount: Int = 0
    
    let tileSize = CGFloat(TILE_SIZE)
    private(set) var renderingScale: CGFloat = 1
    private(set) var cameraViewport: IntRect = .zero
    private(set) var cameraViewportOffset: Vector2d = .zero
        
    private var keyPressed = Set<EmulatedKey>()
    private var keyDown = Set<EmulatedKey>()
    private var currentChar: UInt32 = 0
    
    private var worldHeight: Int = 0
    private var worldWidth: Int = 0
    
    private(set) var tileMapImages: [UIImage] = []
    private var currentBiomeVariant: Int = 0
    
    init() {
        initialize_config(
            Float(TILE_SIZE * 1.8),
            currentLang(),
            dataFolder(),
            speciesJson(),
            inventoryJson(),
            saveJson(),
            langFolder()
        )
        initialize_game(false)
    }
    
    func update(deltaTime: Float) {
        updateKeyboardState(timeSinceLastUpdate: deltaTime)
        update_game(deltaTime)
        
        if current_world_id() != currentWorldId {
            currentWorldId = current_world_id()
            keyDown.removeAll()
            keyPressed.removeAll()
            generateTileMapImage()
        }
        updateBiomeVariant()
        updateCameraParams()
        updateFpsCounter()
        flushKeyboard()
    }
    
    func renderEntities(_ render: @escaping (RenderableItem) -> Void) {
        fetchRenderableItems { items in
            items.forEach { item in
                render(item)
            }
        }
    }

    func setupChanged(windowSize: CGSize, screenScale: CGFloat?) {
        renderingScale = renderingScaleUseCase.calculate(windowSize: windowSize, screenScale: screenScale)
        size = windowSize
        
        window_size_changed(
            Float(size.width),
            Float(size.height),
            Float(renderingScale),
            12,
            8
        )
        worldHeight = Int(current_world_height())
        worldWidth = Int(current_world_width())
        generateTileMapImage()
    }
    
    func renderingFrame(for entity: RenderableItem) -> CGRect {
        renderingFrame(for: entity.frame, offset: entity.offset)
    }
    
    func tileMapImage() -> UIImage? {
        if currentBiomeVariant < tileMapImages.count {
            tileMapImages[currentBiomeVariant]
        } else {
            nil
        }
    }
    
    private func renderingFrame(for frame: IntRect, offset: Vector2d = .zero) -> CGRect {
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
        if keyDown.contains(key) {
            return
        }
        keyPressed.insert(key)
        keyDown.insert(key)
    }
    
    func setKeyUp(_ key: EmulatedKey) {
        keyPressed.remove(key)
        keyDown.remove(key)
    }
    
    private func flushKeyboard() {
        for key in keyPressed {
            keyDown.insert(key)
        }
        keyPressed.removeAll()
        
        keyDown.remove(.attack)
        keyDown.remove(.backspace)
        keyDown.remove(.confirm)
        keyDown.remove(.escape)
        keyDown.remove(.menu)
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
    
    private func updateBiomeVariant() {
        currentBiomeVariant = Int(current_biome_tiles_variant())
    }
    
    private func updateCameraParams() {
        let cv = camera_viewport()
        cameraViewport = IntRect(x: cv.x, y: cv.y, width: cv.w, height: cv.h)
        
        let cvo = camera_viewport_offset()
        cameraViewportOffset = Vector2d(x: cvo.x, y: cvo.y)
    }
    
    private func generateTileMapImage() {
        fetchBiomeTiles { biomeTiles in
            fetchConstructionTiles { constructionTiles in
                self.tileMapImages = (0...4).compactMap { variant in
                    self.tileMapImageGenerator.generate(
                        renderingScale: self.renderingScale,
                        worldWidth: self.worldWidth,
                        worldHeight: self.worldHeight,
                        variant: Int32(variant),
                        biomeTiles: biomeTiles,
                        constructionTiles: constructionTiles
                    )
                }
            }
        }
    }
    
    private func updateFpsCounter() {
        frameCount += 1
        let now = Date()
        let elapsed = now.timeIntervalSince(lastFpsUpdate)
        if elapsed >= 1.0 {
            fps = Double(frameCount) / elapsed
            frameCount = 0
            lastFpsUpdate = now
        }
    }
}
