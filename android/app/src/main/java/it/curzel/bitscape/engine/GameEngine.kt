package it.curzel.bitscape.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Size
import it.curzel.bitscape.AssetUtils
import it.curzel.bitscape.analytics.RuntimeEvent
import it.curzel.bitscape.analytics.RuntimeEventsBroker
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.gamecore.IntRect
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.gamecore.RenderableItem
import it.curzel.bitscape.gamecore.Vector2d
import it.curzel.bitscape.rendering.LoadingScreenConfig
import it.curzel.bitscape.rendering.MenuConfig
import it.curzel.bitscape.rendering.ToastConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
    private val broker: RuntimeEventsBroker
) {
    private val renderingScaleUseCase = RenderingScaleUseCase(context)
    private val tileMapsStorage = TileMapsStorage(context)

    private val _loadingScreenConfig = MutableStateFlow(LoadingScreenConfig.none)
    private val _showsDeathScreen = MutableStateFlow(false)
    private val _heroHp = MutableStateFlow(100.0f)
    private val _isSwordEquipped = MutableStateFlow(false)
    private val _numberOfKunai = MutableStateFlow(0)
    private val _toastConfig = MutableStateFlow(ToastConfig.none)
    private val _menuConfig = MutableStateFlow(MenuConfig.none)
    private var _isNight = false
    private var _isLimitedVisibility = false
    private var _isInteractionEnabled = MutableStateFlow(false)

    var size = Size(0, 0)
    var fps = 0.0

    private var currentWorldId = 0u
    private var lastFpsUpdate = System.currentTimeMillis()
    private var frameCount = 0

    private val tileSize = NativeLib.TILE_SIZE.toFloat()

    var renderingScale = 1f
    var cameraViewport = IntRect(0, 0, 0, 0)
    var cameraViewportOffset = Vector2d(0.0f, 0.0f)
    var canRender = true

    private val keyPressed = mutableSetOf<EmulatedKey>()
    private val keyDown = mutableSetOf<EmulatedKey>()
    private var currentChar: Int = 0

    private var worldHeight = 0
    private var worldWidth = 0
    private var isBusy = false

    private var tileMapImages = emptyList<Bitmap>()
    private var currentBiomeVariant = 0

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
        if (isBusy) return
        val wasDead = _showsDeathScreen.value
        val isDead = nativeLib.showsDeathScreen()

        updateKeyboardState(deltaTime)
        nativeLib.updateGame(deltaTime)
        _menuConfig.value = nativeLib.menuConfig()
        _toastConfig.value = nativeLib.toastConfig()
        _isSwordEquipped.value = nativeLib.isSwordEquipped()
        _heroHp.value = nativeLib.currentHeroHp()
        _numberOfKunai.value = nativeLib.numberOfKunaiInInventory()
        _showsDeathScreen.value = isDead
        _isInteractionEnabled.value = nativeLib.isInteractionAvailable()
        currentBiomeVariant = nativeLib.currentBiomeTilesVariant()
        cameraViewport = nativeLib.cameraViewport().toRect()
        cameraViewportOffset = nativeLib.cameraViewportOffset().toVector2d()

        if (isDead && !wasDead) {
            broker.send(RuntimeEvent.GameOver)
        }

        val freshWorldId = nativeLib.currentWorldId().toUInt()
        if (freshWorldId != currentWorldId) {
            broker.send(RuntimeEvent.WorldTransition(currentWorldId, freshWorldId))
            currentWorldId = freshWorldId
            _isNight = nativeLib.isNight()
            _isLimitedVisibility = nativeLib.isLimitedVisibility()
            keyDown.clear()
            keyPressed.clear()
            updateTileMapImages(freshWorldId)
            audioEngine.updateSoundTrack()
        }

        updateFpsCounter()
        flushKeyboard()
        audioEngine.update()
    }

    fun pause() {
        isBusy = true
    }

    fun resume() {
        isBusy = false
    }

    private fun currentLang(): String {
        return Locale.getDefault().language
            .lowercase()
            .replace("-", "_")
            .split("_")
            .firstOrNull() ?: "en"
    }

    fun numberOfKunai(): StateFlow<Int> {
        return _numberOfKunai.asStateFlow()
    }

    fun showsDeathScreen(): StateFlow<Boolean> {
        return _showsDeathScreen.asStateFlow()
    }

    fun heroHp(): StateFlow<Float> {
        return _heroHp.asStateFlow()
    }

    fun isSwordEquipped(): StateFlow<Boolean> {
        return _isSwordEquipped.asStateFlow()
    }

    fun loadingScreenConfig(): StateFlow<LoadingScreenConfig> {
        return _loadingScreenConfig.asStateFlow()
    }

    fun toastConfig(): StateFlow<ToastConfig> {
        return _toastConfig.asStateFlow()
    }

    fun menuConfig(): StateFlow<MenuConfig> {
        return _menuConfig.asStateFlow()
    }

    fun isNight(): Boolean {
        return _isNight
    }

    fun isLimitedVisibility(): Boolean {
        return _isLimitedVisibility
    }

    fun isInteractionEnabled(): StateFlow<Boolean> {
        return _isInteractionEnabled.asStateFlow()
    }

    fun startNewGame() {
        broker.send(RuntimeEvent.NewGame)
        _showsDeathScreen.value = false
        nativeLib.startNewGame()
    }

    fun renderableItems(): List<RenderableItem> {
        return nativeLib.fetchRenderableItems()
    }

    fun setupChanged(windowSize: Size) {
        renderingScale = renderingScaleUseCase.current()
        size = windowSize

        nativeLib.windowSizeChanged(
            size.width.toFloat(),
            size.height.toFloat(),
            renderingScale,
            12f,
            8f
        )
        worldWidth = nativeLib.currentWorldWidth()
        worldHeight = nativeLib.currentWorldHeight()
        updateTileMapImages(currentWorldId)
    }

    fun renderingFrame(entity: RenderableItem): RectF {
        return renderingFrame(entity.frame, entity.offset)
    }

    fun tileMapImage(): Bitmap? {
        return tileMapImages.getOrNull(currentBiomeVariant) ?: tileMapImages.firstOrNull()
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

    fun setDidType(char: Char) {
        currentChar = char.code.toInt()
    }

    fun setDidTypeNothing() {
        currentChar = 0
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
        // logKeyboardState()

        nativeLib.updateKeyboard(
            keyPressed.contains(EmulatedKey.UP),
            keyPressed.contains(EmulatedKey.RIGHT),
            keyPressed.contains(EmulatedKey.DOWN),
            keyPressed.contains(EmulatedKey.LEFT),
            keyDown.contains(EmulatedKey.UP),
            keyDown.contains(EmulatedKey.RIGHT),
            keyDown.contains(EmulatedKey.DOWN),
            keyDown.contains(EmulatedKey.LEFT),
            keyPressed.contains(EmulatedKey.ESCAPE),
            keyPressed.contains(EmulatedKey.MENU),
            keyPressed.contains(EmulatedKey.CONFIRM),
            keyPressed.contains(EmulatedKey.CLOSE_RANGE_ATTACK),
            keyPressed.contains(EmulatedKey.RANGED_ATTACK),
            deltaTime
        )
    }

    private fun updateTileMapImages(worldId: UInt) {
        setLoading(LoadingScreenConfig.worldTransition)

        CoroutineScope(Dispatchers.IO + Job()).launch {
            tileMapImages = tileMapsStorage.images(worldId)
            setLoading(LoadingScreenConfig.none)
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

    fun onMenuItemSelection(index: Int) {
        nativeLib.selectCurrentMenuOptionAtIndex(index)
        setKeyDown(EmulatedKey.CONFIRM)
    }

    private fun setLoading(mode: LoadingScreenConfig) {
        if (mode.isVisible) {
            setLoadingNow(mode)
        } else {
            Handler(Looper.getMainLooper()).postDelayed({
                setLoadingNow(mode)
            }, 100)
        }
    }

    private fun setLoadingNow(mode: LoadingScreenConfig) {
        canRender = !mode.isVisible
        isBusy = mode.isVisible
        _loadingScreenConfig.value = mode
    }

    private fun storagePath(): String {
        val fileName = "save.json"
        val file = File(context.filesDir, fileName)
        ensureFileExists(file, "{}")
        return file.absolutePath
    }

    private fun ensureFileExists(file: File, defaultContents: String) {
        if (!file.exists()) {
            try {
                file.parentFile?.mkdirs()
                file.createNewFile()
                file.writeText(defaultContents)
                Log.d("MainActivity", "Created new file: ${file.absolutePath}")
            } catch (e: IOException) {
                Log.e("MainActivity", "Failed to create file: ${file.absolutePath}", e)
            }
        } else {
            Log.d("MainActivity", "File already exists: ${file.absolutePath}")
        }
    }
}

private fun IntArray.toRect(): IntRect {
    return IntRect(this[0], this[1], this[2], this[3])
}

private fun FloatArray.toVector2d(): Vector2d {
    return Vector2d(this[0], this[1])
}
