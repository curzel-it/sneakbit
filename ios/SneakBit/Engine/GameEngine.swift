import Foundation
import Combine
import UIKit
import Schwifty

class GameEngine {
    @Inject private var audioEngine: AudioEngine
    @Inject private var broker: RuntimeEventsBroker
    @Inject private var renderingScaleUseCase: RenderingScaleUseCase
    @Inject private var tileMapsStorage: TileMapsStorage
    
    private var currentState: GameState? = nil {
        didSet {
            _state.send(currentState)
        }
    }
    
    private let _state = CurrentValueSubject<GameState?, Never>(nil)
    let isLoading = CurrentValueSubject<Bool, Never>(true)
    
    var size: CGSize = .zero
    var fps: Double = 0.0
    
    var isLandscape: Bool {
        cameraViewport.w >= cameraViewport.h
    }
    
    var currentPlayerIndex: UInt {
        currentState?.current_player_index ?? 0
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
    
    private var worldHeight: Int = 0
    private var worldWidth: Int = 0
    private var isGamePaused: Bool = false
    
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
        initialize_game(GameMode_RealTimeCoOp)
    }
    
    func gameState() -> AnyPublisher<GameState, Never> {
        _state
            .compactMap { $0 }
            .receive(on: DispatchQueue.main)
            .eraseToAnyPublisher()
    }
    
    func update(deltaTime: Float) {
        updateKeyboardState(timeSinceLastUpdate: deltaTime)
        
        let wasPaused = isGamePaused
        if !wasPaused {
            update_game(deltaTime)
        }
        
        fetchRenderingInfo()
        handleWorldChanged()
        updateFpsCounter()
        flushKeyboard()
        
        if !wasPaused {
            audioEngine.updateSoundEffects()
        }
        
        let newState = game_state()
        if newState.shouldPauseGame() {
            pauseGame()
        }
        currentState = newState
    }
    
    private func handleWorldChanged() {
        let newWorld = current_world_id()
        guard newWorld != currentWorldId else { return }
        isLoading.send(true)
        canRender = false
        DispatchQueue.main.asyncAfter(deadline: .now() + WORLD_TRANSITION_TIME) {
            self.canRender = true
            self.isLoading.send(false)
        }
        
        broker.send(.worldTransition(source: currentWorldId, destination: current_world_id()))
        currentWorldId = newWorld
        isNight = is_night()
        isLimitedVisibility = is_limited_visibility()
        keyDown.removeAll()
        keyPressed.removeAll()
        updateTileMapImages()
        audioEngine.updateSoundTrack()
    }
    
    func startNewGame() {
        resumeGame()
        broker.send(.newGame)
        start_new_game()
    }
    
    func pauseGame() {
        isGamePaused = true
    }
    
    func resumeGame() {
        isGamePaused = false
    }
    
    func renderEntities(_ render: @escaping (RenderableItem) -> Void) {
        fetchRenderableItems { items in
            items.forEach { item in
                render(item)
            }
        }
    }

    func setupChanged(safeArea: UIEdgeInsets?, windowSize: CGSize, screenScale: CGFloat?) {
        safeArea.let { safeAreaInsets = $0 }
        renderingScale = renderingScaleUseCase.calculate(windowSize: windowSize, screenScale: screenScale)
        size = windowSize
        window_size_changed(Float(size.width), Float(size.height), Float(renderingScale))
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
        guard !is_turn_prep() else {
            return
        }
        
        for playerIndex in 0..<MAX_PLAYERS {
            if playerIndex == currentPlayerIndex {
                update_keyboard(
                    UInt(playerIndex),
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
                    false,
                    timeSinceLastUpdate
                )
            } else {
                update_keyboard(
                    UInt(playerIndex),
                    false, false, false, false,
                    false, false, false, false,
                    false, false, false,
                    false, false,
                    false,
                    false,
                    timeSinceLastUpdate
                )
            }
        }
    }
    
    private func updateTileMapImages() {
        tileMapImages = tileMapsStorage.images(forWorld: currentWorldId)
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
    
    private func fetchRenderingInfo() {
        currentBiomeVariant = Int(current_biome_tiles_variant())
        cameraViewport = camera_viewport()
        cameraViewportOffset = camera_viewport_offset()
    }
}
