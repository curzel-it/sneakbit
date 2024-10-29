package it.curzel.bitscape.gamecore

class NativeLib {
    external fun testLogs()
    external fun testBool(): Boolean
    external fun currentWorldId(): Int
    external fun initializeGame(creativeMode: Boolean)
    external fun initializeConfig(
        baseEntitySpeed: Float,
        currentLang: String?,
        levelsPath: String?,
        speciesPath: String?,
        inventoryPath: String?,
        keyValueStoragePath: String?,
        localizedStringsPath: String?
    )

    companion object {
        const val TILE_SIZE: Int = 16

        init {
            System.loadLibrary("game_core")
            System.loadLibrary("native-lib")
        }
    }
}
