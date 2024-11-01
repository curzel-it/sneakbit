import Foundation
import Combine
import UIKit
import Schwifty

class GameEngine {
    @Inject private var renderingScaleUseCase: RenderingScaleUseCase
    @Inject private var tileMapsStorage: TileMapsStorage
    
    let toast = CurrentValueSubject<ToastDescriptorC?, Never>(nil)
    let menus = CurrentValueSubject<MenuDescriptorC?, Never>(nil)
    let kunai = CurrentValueSubject<Int32, Never>(0)
    let loadingScreenConfig = CurrentValueSubject<LoadingScreenConfig, Never>(.none)
    let showsDeathScreen = CurrentValueSubject<Bool, Never>(false)
    
    var size: CGSize = .zero
    var fps: Double = 0.0
    var biomeBackground: CGColor = UIColor.black.cgColor
    
    var isLandscape: Bool {
        cameraViewport.w >= cameraViewport.h
    }
    
    private var currentWorldId: UInt32 = 0
    private var lastFpsUpdate: Date = Date()
    private var frameCount: Int = 0
    
    let tileSize = CGFloat(TILE_SIZE)
    private(set) var renderingScale: CGFloat = 1
    private(set) var cameraViewport: IntRect = .zero
    private(set) var cameraViewportOffset: Vector2d = .zero
    private(set) var safeAreaInsets: UIEdgeInsets = .zero
    private(set) var canRender: Bool = true
    private(set) var isNight: Bool = false
    private(set) var isLimitedVisibility: Bool = false
        
    private var keyPressed = Set<EmulatedKey>()
    private var keyDown = Set<EmulatedKey>()
    private var currentChar: UInt32 = 0
    
    private var worldHeight: Int = 0
    private var worldWidth: Int = 0
    private var isBusy: Bool = false
    
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
        guard !isBusy else { return }
        
        updateKeyboardState(timeSinceLastUpdate: deltaTime)
        update_game(deltaTime)
        toast.send(current_toast())
        menus.send(current_menu())
        kunai.send(number_of_kunai_in_inventory())
        showsDeathScreen.send(shows_death_screen())
        currentBiomeVariant = Int(current_biome_tiles_variant())
        cameraViewport = camera_viewport()
        cameraViewportOffset = camera_viewport_offset()
        
        if current_world_id() != currentWorldId {
            print("World changed from \(currentWorldId) to \(current_world_id())")
            currentWorldId = current_world_id()
            isNight = is_night()
            isLimitedVisibility = is_limited_visibility()
            biomeBackground = fetchBiomeBackgroundColor()
            keyDown.removeAll()
            keyPressed.removeAll()
            updateTileMapImages()
        }
        
        updateFpsCounter()
        flushKeyboard()
    }
    
    private func fetchBiomeBackgroundColor() -> CGColor {
        let color: UIColor? = switch current_world_default_tile().tile_type {
        case 0: .init(named: "biome_background_nothing")
        case 1: .init(named: "biome_background_grass")
        case 6: .init(named: "biome_background_water")
        case 16: .init(named: "biome_background_lava")
        default: nil
        }
        return color?.cgColor ?? UIColor.black.cgColor
    }
    
    func renderEntities(_ render: @escaping (RenderableItem) -> Void) {
        fetchRenderableItems { items in
            items.forEach { item in
                render(item)
            }
        }
    }

    func setupChanged(safeArea: UIEdgeInsets?, windowSize: CGSize, screenScale: CGFloat?) {
        if let safeArea {
            safeAreaInsets = safeArea
        }
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
            width: CGFloat(frame.w) * tileSize * renderingScale,
            height: CGFloat(frame.h) * tileSize * renderingScale
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
        // logKeyboardState()
        
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
    
    private func updateTileMapImages() {
        setLoading(.worldTransition)
        
        DispatchQueue.global().async {
            self.tileMapImages = self.tileMapsStorage.images(forWorld: self.currentWorldId)
            self.setLoading(.none)
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
    
    func onMenuItemSelection(index: Int) {
        select_current_menu_option_at_index(UInt32(index))
        setKeyDown(.confirm)
    }
    
    private func setLoading(_ mode: LoadingScreenConfig) {
        if mode.isVisible {
            setLoadingNow(mode)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.setLoadingNow(mode)
            }
        }
    }
    
    private func setLoadingNow(_ mode: LoadingScreenConfig) {
        canRender = !mode.isVisible
        isBusy = mode.isVisible
        loadingScreenConfig.send(mode)
    }
    
    private func logKeyboardState() {
        print("=== Keyboard State Update ===")
        print("Directional Keys Pressed:")
        print("  Up: \(keyPressed.contains(.up))")
        print("  Right: \(keyPressed.contains(.right))")
        print("  Down: \(keyPressed.contains(.down))")
        print("  Left: \(keyPressed.contains(.left))")
        print("Directional Keys Down:")
        print("  Up: \(keyDown.contains(.up))")
        print("  Right: \(keyDown.contains(.right))")
        print("  Down: \(keyDown.contains(.down))")
        print("  Left: \(keyDown.contains(.left))")
        print("Action Keys Pressed:")
        print("  Escape: \(keyPressed.contains(.escape))")
        print("  Menu: \(keyPressed.contains(.menu))")
        print("  Confirm: \(keyPressed.contains(.confirm))")
        print("  Attack: \(keyPressed.contains(.attack))")
        print("  Backspace: \(keyPressed.contains(.backspace))")
        print("Current Character: \(currentChar)")
        print("------------------------------")
    }
}
