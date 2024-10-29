package it.curzel.bitscape.engine

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Size
import it.curzel.bitscape.AssetUtils
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.rendering.EdgeInsets
import it.curzel.bitscape.rendering.IntRect
import it.curzel.bitscape.rendering.SpritesProvider
import it.curzel.bitscape.rendering.Vector2d
import java.io.File
import java.io.IOException
import java.lang.annotation.Native

class GameEngine(
    private val context: Context,
    private val renderingScaleUseCase: RenderingScaleUseCase,
    private val tileMapImageGenerator: TileMapImageGenerator,
    private val tileMapsStorage: TileMapsStorage,
    private val worldRevisionsStorage: WorldRevisionsStorage,
    private val spritesProvider: SpritesProvider
) {
    /*
    val toast = MutableStateFlow<ToastDescriptorC?>(null)
    val menus = MutableStateFlow<MenuDescriptorC?>(null)
    val inventory = MutableStateFlow<List<InventoryItem>>(emptyList())
    val loadingScreenConfig = MutableStateFlow<LoadingScreenConfig>(LoadingScreenConfig.None)
*/
    val showsDeathScreen = MutableStateFlow(false)

    var size = Size(0, 0)
    var fps = 0.0

    private var currentWorldId = 0u
    private var lastFpsUpdate = System.currentTimeMillis()
    private var frameCount = 0

    private val tileSize = TILE_SIZE.toFloat()
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
        /*
                    fetchInventory { items ->
                        inventory.value = items
                    }
*/
        val freshWorldId = nativeLib.currentWorldId().toUInt()
        if (freshWorldId != currentWorldId) {
            println("World changed from $currentWorldId to ${freshWorldId}")
            currentWorldId = freshWorldId
            keyDown.clear()
            keyPressed.clear()
            updateTileMapImages(freshWorldId)
        }

        updateFpsCounter()
        flushKeyboard()
    }/*

    fun renderEntities(render: (RenderableItem) -> Unit) {
        fetchRenderableItems { items ->
            items.forEach { item ->
                render(item)
            }
        }
    }
*/
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
    }/*

    fun renderingFrame(entity: RenderableItem): Rect {
        return renderingFrame(entity.frame, entity.offset)
    }
*/
    fun tileMapImage(): Bitmap? {
        return tileMapImages.getOrNull(currentBiomeVariant)
    }

    private fun renderingFrame(frame: IntRect, offset: Vector2d = Vector2d(0.0f, 0.0f)): Rect {
        val actualCol = (frame.x - cameraViewport.x).toFloat()
        val actualOffsetX = (offset.x - cameraViewportOffset.x).toFloat()

        val actualRow = (frame.y - cameraViewport.y).toFloat()
        val actualOffsetY = (offset.y - cameraViewportOffset.y).toFloat()

        return Rect(
            ((actualCol * tileSize + actualOffsetX) * renderingScale).toInt(),
            ((actualRow * tileSize + actualOffsetY) * renderingScale).toInt(),
            ((frame.w * tileSize) * renderingScale).toInt(),
            ((frame.h * tileSize) * renderingScale).toInt()
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
        Log.d("GameEngine", "=== Keyboard State Update ===")
        Log.d("GameEngine", "Directional Keys Pressed:")
        Log.d("GameEngine", "  Up: ${keyPressed.contains(EmulatedKey.UP)}")
        Log.d("GameEngine", "  Right: ${keyPressed.contains(EmulatedKey.RIGHT)}")
        Log.d("GameEngine", "  Down: ${keyPressed.contains(EmulatedKey.DOWN)}")
        Log.d("GameEngine", "  Left: ${keyPressed.contains(EmulatedKey.LEFT)}")
        Log.d("GameEngine", "Directional Keys Down:")
        Log.d("GameEngine", "  Up: ${keyDown.contains(EmulatedKey.UP)}")
        Log.d("GameEngine", "  Right: ${keyDown.contains(EmulatedKey.RIGHT)}")
        Log.d("GameEngine", "  Down: ${keyDown.contains(EmulatedKey.DOWN)}")
        Log.d("GameEngine", "  Left: ${keyDown.contains(EmulatedKey.LEFT)}")
        Log.d("GameEngine", "Action Keys Pressed:")
        Log.d("GameEngine", "  Escape: ${keyPressed.contains(EmulatedKey.ESCAPE)}")
        Log.d("GameEngine", "  Menu: ${keyPressed.contains(EmulatedKey.MENU)}")
        Log.d("GameEngine", "  Confirm: ${keyPressed.contains(EmulatedKey.CONFIRM)}")
        Log.d("GameEngine", "  Attack: ${keyPressed.contains(EmulatedKey.ATTACK)}")
        Log.d("GameEngine", "  Backspace: ${keyPressed.contains(EmulatedKey.BACKSPACE)}")
        Log.d("GameEngine", "Current Character: $currentChar")
        Log.d("GameEngine", "Time Since Last Update: $deltaTime seconds")
        Log.d("GameEngine", "------------------------------")

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
/*
            nativeLib.fetchUpdatedTiles(worldId) { currentRevision, biomeTiles, constructionTiles ->
                worldRevisionsStorage.store(currentRevision, worldId)

                tileMapImages = (0 until NativeLib.BIOME_NUMBER_OF_FRAMES).mapNotNull { variant ->
                    tileMapImageGenerator.generate(
                        renderingScale,
                        worldWidth,
                        worldHeight,
                        variant,
                        biomeTiles,
                        constructionTiles
                    )
                }
                tileMapsStorage.storeImages(tileMapImages, worldId, requiredRevision)
                // setLoading(LoadingScreenConfig.None)
            }
*/        }

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
}

private fun IntArray.toRect(): IntRect {
    return IntRect(this[0], this[1], this[2], this[3])
}

private fun FloatArray.toVector2d(): Vector2d {
    return Vector2d(this[0], this[1])
}
