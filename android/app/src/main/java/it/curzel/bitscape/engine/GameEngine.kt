package it.curzel.bitscape.rendering

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Handler
import android.os.Looper

class GameEngine @Inject constructor(
    private val renderingScaleUseCase: RenderingScaleUseCase,
    private val tileMapImageGenerator: TileMapImageGenerator,
    private val tileMapsStorage: TileMapsStorage,
    private val worldRevisionsStorage: WorldRevisionsStorage,
    private val spritesProvider: SpritesProvider
) {
    val toast = MutableStateFlow<ToastDescriptorC?>(null)
    val menus = MutableStateFlow<MenuDescriptorC?>(null)
    val inventory = MutableStateFlow<List<InventoryItem>>(emptyList())
    val loadingScreenConfig = MutableStateFlow<LoadingScreenConfig>(LoadingScreenConfig.None)
    val showsDeathScreen = MutableStateFlow(false)

    var size = Size(0, 0)
    var fps = 0.0

    private var currentWorldId = 0u
    private var lastFpsUpdate = System.currentTimeMillis()
    private var frameCount = 0

    private val tileSize = TILE_SIZE.toFloat()
    private var renderingScale = 1f
    private var cameraViewport = IntRect(0, 0, 0, 0)
    private var cameraViewportOffset = Vector2d(0.0, 0.0)
    private var safeAreaInsets = EdgeInsets(0, 0, 0, 0)
    private var canRender = true

    private val keyPressed = mutableSetOf<EmulatedKey>()
    private val keyDown = mutableSetOf<EmulatedKey>()
    private var currentChar = 0u

    private var worldHeight = 0
    private var worldWidth = 0
    private var isBusy = false

    private var tileMapImages = emptyList<Bitmap>()
    private var currentBiomeVariant = 0

    init {
        initialize_config(
            (TILE_SIZE * 1.8f),
            currentLang(),
            dataFolder(),
            speciesJson(),
            inventoryJson(),
            saveJson(),
            langFolder()
        )
        initialize_game(false)
    }

    fun update(deltaTime: Float) {
        if (isBusy) return

        updateKeyboardState(deltaTime)
        update_game(deltaTime)
        toast.value = current_toast()
        menus.value = current_menu()
        showsDeathScreen.value = shows_death_screen()
        currentBiomeVariant = current_biome_tiles_variant().toInt()
        cameraViewport = camera_viewport()
        cameraViewportOffset = camera_viewport_offset()

        fetchInventory { items ->
            inventory.value = items
        }

        if (current_world_id() != currentWorldId) {
            println("World changed from $currentWorldId to ${current_world_id()}")
            currentWorldId = current_world_id()
            keyDown.clear()
            keyPressed.clear()
            updateTileMapImages()
        }

        updateFpsCounter()
        flushKeyboard()
    }

    fun renderEntities(render: (RenderableItem) -> Unit) {
        fetchRenderableItems { items ->
            items.forEach { item ->
                render(item)
            }
        }
    }

    fun setupChanged(safeArea: EdgeInsets?, windowSize: Size, screenScale: Float?) {
        safeArea?.let {
            safeAreaInsets = it
        }
        renderingScale = renderingScaleUseCase.calculate(windowSize, screenScale)
        size = windowSize

        window_size_changed(
            size.width.toFloat(),
            size.height.toFloat(),
            renderingScale,
            12f,
            8f
        )
        worldHeight = current_world_height().toInt()
        worldWidth = current_world_width().toInt()
    }

    fun renderingFrame(entity: RenderableItem): Rect {
        return renderingFrame(entity.frame, entity.offset)
    }

    fun tileMapImage(): Bitmap? {
        return tileMapImages.getOrNull(currentBiomeVariant)
    }

    private fun renderingFrame(frame: IntRect, offset: Vector2d = Vector2d(0.0, 0.0)): Rect {
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
        currentChar = char.code.toUInt()
    }

    fun setDidTypeNothing() {
        currentChar = 0u
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
                EmulatedKey.Attack,
                EmulatedKey.Backspace,
                EmulatedKey.Confirm,
                EmulatedKey.Escape,
                EmulatedKey.Menu
            )
        )
    }

    private fun updateKeyboardState(deltaTime: Float) {
        println("=== Keyboard State Update ===")
        println("Directional Keys Pressed:")
        println("  Up: ${keyPressed.contains(EmulatedKey.Up)}")
        println("  Right: ${keyPressed.contains(EmulatedKey.Right)}")
        println("  Down: ${keyPressed.contains(EmulatedKey.Down)}")
        println("  Left: ${keyPressed.contains(EmulatedKey.Left)}")
        println("Directional Keys Down:")
        println("  Up: ${keyDown.contains(EmulatedKey.Up)}")
        println("  Right: ${keyDown.contains(EmulatedKey.Right)}")
        println("  Down: ${keyDown.contains(EmulatedKey.Down)}")
        println("  Left: ${keyDown.contains(EmulatedKey.Left)}")
        println("Action Keys Pressed:")
        println("  Escape: ${keyPressed.contains(EmulatedKey.Escape)}")
        println("  Menu: ${keyPressed.contains(EmulatedKey.Menu)}")
        println("  Confirm: ${keyPressed.contains(EmulatedKey.Confirm)}")
        println("  Attack: ${keyPressed.contains(EmulatedKey.Attack)}")
        println("  Backspace: ${keyPressed.contains(EmulatedKey.Backspace)}")
        println("Current Character: $currentChar")
        println("Time Since Last Update: $deltaTime seconds")
        println("------------------------------")

        update_keyboard(
            keyPressed.contains(EmulatedKey.Up),
            keyPressed.contains(EmulatedKey.Right),
            keyPressed.contains(EmulatedKey.Down),
            keyPressed.contains(EmulatedKey.Left),
            keyDown.contains(EmulatedKey.Up),
            keyDown.contains(EmulatedKey.Right),
            keyDown.contains(EmulatedKey.Down),
            keyDown.contains(EmulatedKey.Left),
            keyPressed.contains(EmulatedKey.Escape),
            keyPressed.contains(EmulatedKey.Menu),
            keyPressed.contains(EmulatedKey.Confirm),
            keyPressed.contains(EmulatedKey.Attack),
            keyPressed.contains(EmulatedKey.Backspace),
            currentChar,
            deltaTime
        )
    }

    private fun updateTileMapImages() {
        setLoading(LoadingScreenConfig.WorldTransition)

        val worldId = current_world_id()
        val requiredRevision = current_world_revision()
        val images = tileMapsStorage.imagesForWorld(worldId, requiredRevision)

        if (images.size >= BIOME_NUMBER_OF_FRAMES) {
            tileMapImages = images
            setLoading(LoadingScreenConfig.None)
            return
        }

        fetchUpdatedTiles(worldId) { currentRevision, biomeTiles, constructionTiles ->
            worldRevisionsStorage.storeRevision(currentRevision, worldId)

            tileMapImages = (0 until BIOME_NUMBER_OF_FRAMES).mapNotNull { variant ->
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
            setLoading(LoadingScreenConfig.None)
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
        select_current_menu_option_at_index(index.toUInt())
        setKeyDown(EmulatedKey.Confirm)
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
}
