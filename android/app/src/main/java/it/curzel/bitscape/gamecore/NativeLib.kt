package it.curzel.bitscape.gamecore

import android.graphics.Rect
import it.curzel.bitscape.rendering.Vector2d

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

    companion object {
        const val TILE_SIZE: Int = 16
        const val BIOME_NUMBER_OF_FRAMES: Int = 4

        init {
            System.loadLibrary("game_core")
            System.loadLibrary("native-lib")
        }
    }
}