package it.curzel.bitscape.gamecore

class NativeLib {
    external fun testLogs()
    external fun testBool(): Boolean
    external fun initializeConfig(
        baseEntitySpeed: Float,
        currentLang: String?,
        levelsPath: String?,
        speciesPath: String?,
        inventoryPath: String?,
        keyValueStoragePath: String?,
        localizedStringsPath: String?
    )
    external fun initializeGame(creativeMode: Boolean)
    external fun currentWorldId(): Int
    external fun currentWorldWidth(): Int
    external fun currentWorldHeight(): Int
    external fun windowSizeChanged(
        width: Float,
        height: Float,
        renderingScale: Float,
        fontSize: Float,
        lineSpacing: Float
    )
    external fun updateKeyboard(
        upPressed: Boolean,
        rightPressed: Boolean,
        downPressed: Boolean,
        leftPressed: Boolean,
        upDown: Boolean,
        rightDown: Boolean,
        downDown: Boolean,
        leftDown: Boolean,
        escapePressed: Boolean,
        menuPressed: Boolean,
        confirmPressed: Boolean,
        attackPressed: Boolean,
        backspacePressed: Boolean,
        currentChar: Int,
        timeSinceLastUpdate: Float
    )
    external fun updateGame(timeSinceLastUpdate: Float)
    external fun showsDeathScreen(): Boolean
    external fun currentBiomeTilesVariant(): Int
    external fun cameraViewport(): IntArray
    external fun cameraViewportOffset(): FloatArray
    external fun currentWorldRevision(): Int
    external fun fetchUpdatedTiles(worldId: Int): UpdatedTiles

    companion object {
        const val SPRITE_SHEET_BIOME_TILES: UInt = 1002u
        const val SPRITE_SHEET_CONSTRUCTION_TILES: UInt = 1003u
        const val NUMBER_OF_BIOMES: Int = 18
        const val TILE_SIZE: Int = 16
        const val BIOME_NUMBER_OF_FRAMES: Int = 4

        init {
            System.loadLibrary("game_core")
            System.loadLibrary("native-lib")
        }
    }
}

data class UpdatedTiles(
    val currentRevision: UInt,
    val biomeTiles: Array<Array<BiomeTile>>,
    val constructionTiles: Array<Array<ConstructionTile>>
)

data class BiomeTile(
    val tileType: Int,
    val textureOffsetX: Int,
    val textureOffsetY: Int
)

data class ConstructionTile(
    val tileType: Int,
    val textureSourceRect: IntRect
)

data class IntRect(
    val x: Int,
    val y: Int,
    val w: Int,
    val h: Int
)

data class Vector2d(
    val x: Float,
    val y: Float
)

data class EdgeInsets(
    val top: Float,
    val right: Float,
    val down: Float,
    val left: Float,
)

data class RenderableItem(
    val spriteSheetId: UInt,
    val textureRect: IntRect
)
