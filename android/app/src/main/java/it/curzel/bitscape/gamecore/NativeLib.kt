package it.curzel.bitscape.gamecore

import it.curzel.bitscape.rendering.MenuConfig
import it.curzel.bitscape.rendering.ToastConfig

class NativeLib {
    external fun initializeConfig(
        baseEntitySpeed: Float,
        currentLang: String?,
        levelsPath: String?,
        speciesPath: String?,
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
    external fun fetchRenderableItems(): List<RenderableItem>
    external fun numberOfKunaiInInventory(): Int
    external fun toastConfig(): ToastConfig
    external fun menuConfig(): MenuConfig
    external fun selectCurrentMenuOptionAtIndex(index: Int)
    external fun isNight(): Boolean
    external fun isLimitedVisibility(): Boolean
    external fun isInteractionAvailable(): Boolean
    external fun startNewGame()

    companion object {
        const val TILE_SIZE: Int = 16
        const val BIOME_NUMBER_OF_FRAMES: Int = 4

        const val SPRITE_SHEET_BLANK: UInt = 1000u
        const val SPRITE_SHEET_INVENTORY: UInt = 1001u
        const val SPRITE_SHEET_BIOME_TILES: UInt = 1002u
        const val SPRITE_SHEET_CONSTRUCTION_TILES: UInt = 1003u
        const val SPRITE_SHEET_BUILDINGS: UInt = 1004u
        const val SPRITE_SHEET_BASE_ATTACK: UInt = 1005u
        const val SPRITE_SHEET_HUMANOIDS_1X2: UInt = 1009u
        const val SPRITE_SHEET_STATIC_OBJECTS: UInt = 1010u
        const val SPRITE_SHEET_MENU: UInt = 1011u
        const val SPRITE_SHEET_ANIMATED_OBJECTS: UInt = 1012u
        const val SPRITE_SHEET_HUMANOIDS_1X1: UInt = 1014u
        const val SPRITE_SHEET_AVATARS: UInt = 1015u
        const val SPRITE_SHEET_HUMANOIDS_2X2: UInt = 1016u
        const val SPRITE_SHEET_FARM_PLANTS: UInt = 1017u
        const val SPRITE_SHEET_HUMANOIDS_2X3: UInt = 1018u
        const val SPRITE_SHEET_CAVE_DARKNESS: UInt = 1019u

        init {
            System.loadLibrary("game_core")
            System.loadLibrary("native-lib")
        }
    }
}

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

data class RenderableItem(
    val spriteSheetId: UInt,
    val textureRect: IntRect,
    val offset: Vector2d,
    val frame: IntRect
)