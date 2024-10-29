package it.curzel.bitscape.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.RectF
import android.util.Log
import android.util.Size
import it.curzel.bitscape.AssetUtils
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.gamecore.EdgeInsets
import it.curzel.bitscape.gamecore.IntRect
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.gamecore.RenderableItem
import it.curzel.bitscape.gamecore.Vector2d
import kotlinx.coroutines.flow.MutableStateFlow
import java.io.File
import java.io.IOException

class GameEngine(
    private val context: Context,
    private val renderingScaleUseCase: RenderingScaleUseCase,
    private val tileMapImageGenerator: TileMapImageGenerator,
    private val tileMapsStorage: TileMapsStorage,
    private val worldRevisionsStorage: WorldRevisionsStorage
) {

    // val toast = MutableStateFlow<ToastDescriptorC?>(null)
    // val menus = MutableStateFlow<MenuDescriptorC?>(null)
    // val inventory = MutableStateFlow<List<InventoryItem>>(emptyList())
    // val loadingScreenConfig = MutableStateFlow<LoadingScreenConfig>(LoadingScreenConfig.None)

    val showsDeathScreen = MutableStateFlow(false)

    var size = Size(0, 0)
    var fps = 0.0

    private var currentWorldId = 0u
    private var lastFpsUpdate = System.currentTimeMillis()
    private var frameCount = 0

    private val tileSize = NativeLib.TILE_SIZE.toFloat()
    var renderingScale = 1f
    var cameraViewport = IntRect(0, 0, 0, 0)
    var cameraViewportOffset = Vector2d(0.0f, 0.0f)
    private var safeAreaInsets = EdgeInsets(0.0f, 0.0f, 0.0f, 0.0f)
    var canRender = true

    private val keyPressed = mutableSetOf<EmulatedKey>()
    private val keyDown = mutableSetOf<EmulatedKey>()
    private var currentChar: Int = 0

    private var worldHeight = 0
    private var worldWidth = 0
    private var isBusy = false

    private var tileMapImages = emptyList<Bitmap>()
    private var currentBiomeVariant = 0

    private val nativeLib = NativeLib()

    init {
        nativeLib.testLogs()
        val result = nativeLib.testBool()
        Log.d("MainActivity", "Interop working: $result")

        val dataPath = AssetUtils.extractAssetFolder(context, "data", "data")
        val langPath = AssetUtils.extractAssetFolder(context, "lang", "lang")

        nativeLib.initializeConfig(
            baseEntitySpeed = NativeLib.TILE_SIZE * 1.8f,
            currentLang = "en",
            levelsPath = dataPath,
            speciesPath = "$dataPath/species.json",
            inventoryPath = inventoryPath(),
            keyValueStoragePath = storagePath(),
            localizedStringsPath = langPath
        )
        nativeLib.initializeGame(false)
    }

    fun update(deltaTime: Float) {
        if (isBusy) return

        updateKeyboardState(deltaTime)
        nativeLib.updateGame(deltaTime)
        // toast.value = current_toast()
        // menus.value = current_menu()
        showsDeathScreen.value = nativeLib.showsDeathScreen()
        currentBiomeVariant = nativeLib.currentBiomeTilesVariant()
        cameraViewport = nativeLib.cameraViewport().toRect()
        cameraViewportOffset = nativeLib.cameraViewportOffset().toVector2d()
        // fetchInventory { inventory.value = it }

        val freshWorldId = nativeLib.currentWorldId().toUInt()
        if (freshWorldId != currentWorldId) {
            println("World changed from $currentWorldId to $freshWorldId")
            currentWorldId = freshWorldId
            keyDown.clear()
            keyPressed.clear()
            updateTileMapImages(freshWorldId)
        }

        updateFpsCounter()
        flushKeyboard()
    }

    fun renderableItems(): List<RenderableItem> {
        return nativeLib.fetchRenderableItems()
    }

    fun setupChanged(safeArea: EdgeInsets?, windowSize: Size) {
        safeArea?.let {
            safeAreaInsets = it
        }
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
        return tileMapImages.getOrNull(currentBiomeVariant)
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
                EmulatedKey.ATTACK,
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
            keyPressed.contains(EmulatedKey.ATTACK),
            keyPressed.contains(EmulatedKey.BACKSPACE),
            currentChar,
            deltaTime
        )
    }

    private fun updateTileMapImages(worldId: UInt) {
        // setLoading(LoadingScreenConfig.WorldTransition)

        val requiredRevision = nativeLib.currentWorldRevision().toUInt()
        val images = tileMapsStorage.images(worldId, requiredRevision)

        if (images.size >= NativeLib.BIOME_NUMBER_OF_FRAMES) {
            tileMapImages = images
            // setLoading(LoadingScreenConfig.None)
            return
        }

        val updatedTiles = nativeLib.fetchUpdatedTiles(worldId.toInt())
        worldRevisionsStorage.store(updatedTiles.currentRevision, worldId)

        tileMapImages = (0 until NativeLib.BIOME_NUMBER_OF_FRAMES).mapNotNull { variant ->
            tileMapImageGenerator.generate(
                worldWidth,
                worldHeight,
                variant,
                updatedTiles.biomeTiles,
                updatedTiles.constructionTiles
            )
        }
        tileMapsStorage.store(tileMapImages, worldId, requiredRevision)
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
    }/*

    fun onMenuItemSelection(index: Int) {
        select_current_menu_option_at_index(index.toUInt())
        setKeyDown(EmulatedKey.CONFIRM)
    }

    fun setLoading(mode: LoadingScreenConfig) {
        if (mode.isVisible) {
            setLoadingNow(mode)
        } else {
            Handler(Looper.getMainLooper()).postDelayed({
                setLoadingNow(mode)
            }, 300)
        }
    }

    private fun setLoadingNow(mode: LoadingScreenConfig) {
        canRender = !mode.isVisible
        isBusy = mode.isVisible
        loadingScreenConfig.value = mode
    }
*/
    private fun inventoryPath(): String {
        val fileName = "inventory.json"
        val file = File(context.filesDir, fileName)
        ensureFileExists(file, "[]")
        return file.absolutePath
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

    private fun logKeyboardState() {
        val state = mutableListOf<String>()
        state.add("=== Keyboard State Update ===")
        state.add("Directional Keys Pressed:")
        state.add("  Up: ${keyPressed.contains(EmulatedKey.UP)}")
        state.add("  Right: ${keyPressed.contains(EmulatedKey.RIGHT)}")
        state.add("  Down: ${keyPressed.contains(EmulatedKey.DOWN)}")
        state.add("  Left: ${keyPressed.contains(EmulatedKey.LEFT)}")
        state.add("Directional Keys Down:")
        state.add("  Up: ${keyDown.contains(EmulatedKey.UP)}")
        state.add("  Right: ${keyDown.contains(EmulatedKey.RIGHT)}")
        state.add("  Down: ${keyDown.contains(EmulatedKey.DOWN)}")
        state.add("  Left: ${keyDown.contains(EmulatedKey.LEFT)}")
        state.add("Action Keys Pressed:")
        state.add("  Escape: ${keyPressed.contains(EmulatedKey.ESCAPE)}")
        state.add("  Menu: ${keyPressed.contains(EmulatedKey.MENU)}")
        state.add("  Confirm: ${keyPressed.contains(EmulatedKey.CONFIRM)}")
        state.add("  Attack: ${keyPressed.contains(EmulatedKey.ATTACK)}")
        state.add("  Backspace: ${keyPressed.contains(EmulatedKey.BACKSPACE)}")
        state.add("Current Character: $currentChar")
        state.add("------------------------------")
        Log.d("GameEngine", "Keyboard state: ${state.joinToString("\n")}")
    }
}

private fun IntArray.toRect(): IntRect {
    return IntRect(this[0], this[1], this[2], this[3])
}

private fun FloatArray.toVector2d(): Vector2d {
    return Vector2d(this[0], this[1])
}
