package it.curzel.bitscape.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.RectF
import android.util.Log
import android.util.Size
import it.curzel.bitscape.analytics.RuntimeEventsBroker
import it.curzel.bitscape.AssetUtils
import it.curzel.bitscape.analytics.RuntimeEvent
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.gamecore.GameState
import it.curzel.bitscape.gamecore.IntRect
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.gamecore.RenderableItem
import it.curzel.bitscape.gamecore.Vector2d
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException
import java.util.Locale

class GameEngine(
    private val context: Context,
    private val nativeLib: NativeLib,
    private val audioEngine: AudioEngine,
    private val broker: RuntimeEventsBroker,
    private val scope: CoroutineScope
) {
    private val _gameState = MutableStateFlow<GameState?>(null)
    val gameState: StateFlow<GameState?> = _gameState.asStateFlow()

    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    var size = Size(0, 0)
    var fps = 0.0

    private var isGamePaused = false
    private var currentWorldId = 0u
    private var lastFpsUpdate = System.currentTimeMillis()
    private var frameCount = 0

    var renderingScale = 1f
    var cameraViewport = IntRect(0, 0, 0, 0)
    var cameraViewportOffset = Vector2d(0.0f, 0.0f)
    var canRender = true

    private var isLimitedVisibility: Boolean = false
    private var isNight: Boolean = false

    private val keyPressed = mutableSetOf<EmulatedKey>()
    private val keyDown = mutableSetOf<EmulatedKey>()

    private var worldHeight = 0
    private var worldWidth = 0

    private var tileMapImages = emptyList<Bitmap>()
    private var currentBiomeVariant = 0

    private val renderingScaleUseCase = RenderingScaleUseCase(context)
    private val tileMapsStorage = TileMapsStorage(context)
    private val tileSize = NativeLib.TILE_SIZE.toFloat()

    init {
        val dataPath = AssetUtils.extractAssetFolder(context, "data", "data")
        val langPath = AssetUtils.extractAssetFolder(context, "lang", "lang")

        nativeLib.initializeConfig(
            baseEntitySpeed = NativeLib.TILE_SIZE * 1.8f,
            currentLang = currentLang(),
            levelsPath = dataPath,
            speciesPath = "$dataPath/species.json",
            keyValueStoragePath = storagePath(),
            localizedStringsPath = langPath
        )
        nativeLib.initializeGame()
    }

    fun update(deltaTime: Float) {
        updateKeyboardState(deltaTime)

        val wasPaused = isGamePaused
        if (!wasPaused) {
            nativeLib.updateGame(deltaTime)
        }
        fetchRenderingInfo()
        handleWorldChanged()
        updateFpsCounter()
        flushKeyboard()

        if (!wasPaused) {
            audioEngine.updateSoundEffects()
        }

        val nextState = nativeLib.gameState()
        if (nextState.shouldPauseGame()) {
            pauseGame()
        }
        _gameState.value = nextState
    }

    fun pauseGame() {
        isGamePaused = true
    }

    fun resumeGame() {
        isGamePaused = false
    }

    fun startNewGame() {
        resumeGame()
        broker.send(RuntimeEvent.NewGame)
        nativeLib.startNewGame()
    }

    fun renderableItems(): List<RenderableItem> {
        return nativeLib.fetchRenderableItems()
    }

    fun setupChanged(windowSize: Size) {
        renderingScale = renderingScaleUseCase.current()
        size = windowSize
        nativeLib.windowSizeChanged(size.width.toFloat(), size.height.toFloat(), renderingScale)
        worldWidth = nativeLib.currentWorldWidth()
        worldHeight = nativeLib.currentWorldHeight()
        updateTileMapImages()
    }

    fun renderingFrame(entity: RenderableItem): RectF {
        return renderingFrame(entity.frame, entity.offset)
    }

    fun tileMapImage(): Bitmap? {
        return tileMapImages.getOrNull(currentBiomeVariant) ?: tileMapImages.firstOrNull()
    }

    fun setKeyDown(key: EmulatedKey) {
        if (keyDown.add(key)) {
            keyPressed.add(key)
        }
    }

    fun setKeyUp(key: EmulatedKey) {
        keyPressed.remove(key)
        keyDown.remove(key)
    }

    fun fastTravelOptions(): IntArray {
        return nativeLib.fastTravelOptions()
    }

    fun cancelFastTravel() {
        nativeLib.cancelFastTravel()
        resumeGame()
    }

    fun handleFastTravel(destination: Int) {
        nativeLib.handleFastTravel(destination)
        resumeGame()
    }

    fun exitPvp() {
        nativeLib.exitPvpArena()
        resumeGame()
    }

    fun cancelPvpArena() {
        nativeLib.cancelPvpArenaRequest()
        resumeGame()
    }

    fun handlePvpArena(numberOfPlayers: Int) {
        nativeLib.handlePvpArena(numberOfPlayers)
        resumeGame()
    }

    private fun currentPlayerIndex(): Int {
        return gameState.value?.currentPlayerIndex ?: 0
    }

    private fun flushKeyboard() {
        keyPressed.clear()
        keyDown.removeAll(
            listOf(
                EmulatedKey.CLOSE_RANGE_ATTACK,
                EmulatedKey.RANGED_ATTACK,
                EmulatedKey.BACKSPACE,
                EmulatedKey.CONFIRM,
                EmulatedKey.ESCAPE,
                EmulatedKey.MENU
            )
        )
    }

    private fun updateKeyboardState(deltaTime: Float) {
        if (nativeLib.isTurnPrep()) {
            return
        }

        (0..<NativeLib.MAX_PLAYERS).forEach { playerIndex ->
            if (playerIndex == currentPlayerIndex()) {
                nativeLib.updateKeyboard(
                    player = playerIndex,
                    upPressed = keyPressed.contains(EmulatedKey.UP),
                    rightPressed = keyPressed.contains(EmulatedKey.RIGHT),
                    downPressed = keyPressed.contains(EmulatedKey.DOWN),
                    leftPressed = keyPressed.contains(EmulatedKey.LEFT),
                    upDown = keyDown.contains(EmulatedKey.UP),
                    rightDown = keyDown.contains(EmulatedKey.RIGHT),
                    downDown = keyDown.contains(EmulatedKey.DOWN),
                    leftDown = keyDown.contains(EmulatedKey.LEFT),
                    escapePressed = keyPressed.contains(EmulatedKey.ESCAPE),
                    menuPressed = keyPressed.contains(EmulatedKey.MENU),
                    confirmPressed = keyPressed.contains(EmulatedKey.CONFIRM),
                    closeAttackPressed = keyPressed.contains(EmulatedKey.CLOSE_RANGE_ATTACK),
                    rangedAttackPressed = keyPressed.contains(EmulatedKey.RANGED_ATTACK),
                    timeSinceLastUpdate = deltaTime
                )
            } else {
                nativeLib.updateKeyboard(
                    player = playerIndex,
                    upPressed = false,
                    rightPressed = false,
                    downPressed = false,
                    leftPressed = false,
                    upDown = false,
                    rightDown = false,
                    downDown = false,
                    leftDown = false,
                    escapePressed = false,
                    menuPressed = false,
                    confirmPressed = false,
                    closeAttackPressed = false,
                    rangedAttackPressed = false,
                    timeSinceLastUpdate = deltaTime
                )
            }
        }
    }

    private fun updateFpsCounter() {
        frameCount++
        val now = System.currentTimeMillis()
        val elapsed = (now - lastFpsUpdate) / 1000.0

        if (elapsed >= 1.0) {
            fps = frameCount / elapsed
            frameCount = 0
            lastFpsUpdate = now
        }
    }

    private fun handleWorldChanged() {
        val newWorld = nativeLib.currentWorldId().toUInt()
        if (newWorld == currentWorldId) { return }
        _isLoading.value = true
        canRender = false

        scope.launch {
            delay(300)
            canRender = true
            _isLoading.value = false
        }

        broker.send(RuntimeEvent.WorldTransition(currentWorldId, newWorld))
        currentWorldId = newWorld
        isNight = nativeLib.isNight()
        isLimitedVisibility = nativeLib.isLimitedVisibility()
        keyDown.clear()
        keyPressed.clear()
        updateTileMapImages()
        audioEngine.updateSoundTrack()
    }

    private fun updateTileMapImages() {
        tileMapImages = tileMapsStorage.images(currentWorldId)
    }

    private fun ensureJsonFileExists(file: File) {
        if (!file.exists()) {
            try {
                file.parentFile?.mkdirs()
                file.createNewFile()
                file.writeText("{}")
                Log.d("GameEngine", "Created new file: ${file.absolutePath}")
            } catch (e: IOException) {
                Log.e("GameEngine", "Failed to create file: ${file.absolutePath}", e)
            }
        } else {
            Log.d("GameEngine", "File already exists: ${file.absolutePath}")
        }
    }

    private fun currentLang(): String {
        return Locale.getDefault().language
            .lowercase()
            .replace("-", "_")
            .split("_")
            .firstOrNull() ?: "en"
    }

    private fun storagePath(): String {
        val fileName = "save.json"
        val file = File(context.filesDir, fileName)
        ensureJsonFileExists(file)
        return file.absolutePath
    }

    private fun renderingFrame(frame: IntRect, offset: Vector2d = Vector2d(0.0f, 0.0f)): RectF {
        val actualCol = (frame.x - cameraViewport.x).toFloat()
        val actualOffsetX = offset.x - cameraViewportOffset.x
        val actualRow = (frame.y - cameraViewport.y).toFloat()
        val actualOffsetY = offset.y - cameraViewportOffset.y

        val x = (actualCol * tileSize + actualOffsetX) * renderingScale
        val y = (actualRow * tileSize + actualOffsetY) * renderingScale

        return RectF(
            x, y,
            x + (frame.w * tileSize) * renderingScale,
            y + (frame.h * tileSize) * renderingScale
        )
    }

    fun isLimitedVisibility(): Boolean {
        return isLimitedVisibility
    }

    fun isNight(): Boolean {
        return isNight
    }

    private fun fetchRenderingInfo() {
        currentBiomeVariant = nativeLib.currentBiomeTilesVariant()
        cameraViewport = nativeLib.cameraViewport().toRect()
        cameraViewportOffset = nativeLib.cameraViewportOffset().toVector2d()
    }

    private fun IntArray.toRect(): IntRect {
        return IntRect(this[0], this[1], this[2], this[3])
    }

    private fun FloatArray.toVector2d(): Vector2d {
        return Vector2d(this[0], this[1])
    }

    fun revive() {
        nativeLib.revive()
        resumeGame()
    }

    fun isPvp(): Boolean {
        return nativeLib.isPvp()
    }
}
