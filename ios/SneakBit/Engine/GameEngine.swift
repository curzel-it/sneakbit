import Foundation
import Combine
import UIKit
import Schwifty

class GameEngine {
    @Inject private var audioEngine: AudioEngine
    @Inject private var broker: RuntimeEventsBroker
    @Inject private var renderingScaleUseCase: RenderingScaleUseCase
    @Inject private var tileMapsStorage: TileMapsStorage
    
    let toast = CurrentValueSubject<ToastDescriptorC?, Never>(nil)
    let menus = CurrentValueSubject<MenuDescriptorC?, Never>(nil)
    let kunai = CurrentValueSubject<Int32, Never>(0)
    let isInteractionAvailable = CurrentValueSubject<Bool, Never>(false)
    let loadingScreenConfig = CurrentValueSubject<LoadingScreenConfig, Never>(.none)
    let showsDeathScreen = CurrentValueSubject<Bool, Never>(false)
    let heroHp = CurrentValueSubject<Float32, Never>(100)
    let isSwordEquipped = CurrentValueSubject<Bool, Never>(false)
    
    var size: CGSize = .zero
    var fps: Double = 0.0
    
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
            true,
            Float(TILE_SIZE * 1.8),
            currentLang(),
            dataFolder(),
            speciesJson(),
            saveJson(),
            langFolder()
        )
        initialize_game(false)
    }
    
    func update(deltaTime: Float) {
        guard !isBusy else { return }
        let wasDead = showsDeathScreen.value
        let isDead = shows_death_screen()
        
        updateKeyboardState(timeSinceLastUpdate: deltaTime)
        update_game(deltaTime)
        toast.send(current_toast())
        menus.send(current_menu())
        kunai.send(number_of_kunai_in_inventory())
        heroHp.send(current_hero_hp())
        isSwordEquipped.send(is_sword_equipped())
        isInteractionAvailable.send(is_interaction_available())
        showsDeathScreen.send(isDead)
        currentBiomeVariant = Int(current_biome_tiles_variant())
        cameraViewport = camera_viewport()
        cameraViewportOffset = camera_viewport_offset()
        
        if isDead && !wasDead {
            broker.send(.gameOver)
        }
        
        if current_world_id() != currentWorldId {
            broker.send(.worldTransition(source: currentWorldId, destination: current_world_id()))
            currentWorldId = current_world_id()
            isNight = is_night()
            isLimitedVisibility = is_limited_visibility()
            keyDown.removeAll()
            keyPressed.removeAll()
            updateTileMapImages()
            audioEngine.updateSoundTrack()
        }
        
        updateFpsCounter()
        flushKeyboard()
        audioEngine.update()
    }
    
    func startNewGame() {
        showsDeathScreen.send(false)
        broker.send(.newGame)
        start_new_game()
    }
    
    func pause() {
        isBusy = true
    }
    
    func resume() {
        isBusy = false
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
        for key in keyPressed where key.isMovement {
            keyDown.insert(key)
        }
        keyPressed.removeAll()
        
        keyDown.remove(.closeRangeAttack)
        keyDown.remove(.rangedAttack)
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
            keyPressed.contains(.closeRangeAttack),
            keyPressed.contains(.rangedAttack),
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
}
