package it.curzel.bitscape.gamecore

class NativeLib {
    external fun initializeConfig(
        baseEntitySpeed: Float,
        currentLang: String?,
        levelsPath: String?,
        speciesPath: String?,
        keyValueStoragePath: String?,
        localizedStringsPath: String?
    )
    external fun initializeGame()
    external fun currentWorldId(): Int
    external fun currentWorldWidth(): Int
    external fun currentWorldHeight(): Int
    external fun windowSizeChanged(width: Float, height: Float, renderingScale: Float)
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
        closeAttackPressed: Boolean,
        rangedAttackPressed: Boolean,
        timeSinceLastUpdate: Float
    )
    external fun updateGame(timeSinceLastUpdate: Float)
    external fun currentBiomeTilesVariant(): Int
    external fun cameraViewport(): IntArray
    external fun cameraViewportOffset(): FloatArray
    external fun fetchRenderableItems(): List<RenderableItem>
    external fun numberOfKunaiInInventory(): Int
    external fun isNight(): Boolean
    external fun isLimitedVisibility(): Boolean
    external fun isInteractionAvailable(): Boolean
    external fun startNewGame()
    external fun currentSoundEffects(): List<Int>
    external fun currentSoundTrack(): String
    external fun isSwordEquipped(): Boolean
    external fun playerCurrentHp(): Float
    external fun nextMessage(): DisplayableMessage?
    external fun nextToast(): DisplayableToast?
    external fun matchResult(): MatchResult
    external fun revive()
    external fun hasRequestedFastTravel(): Boolean
    external fun fastTravelOptions(): IntArray
    external fun cancelFastTravel()
    external fun handleFastTravel(destination: Int)
    external fun hasRequestedPvpArena(): Boolean
    external fun handlePvpArena(numberOfPlayers: Int)
    external fun cancelPvpArenaRequest()
    external fun exitPvpArena()
    external fun isPvp(): Boolean

    companion object {
        const val TILE_SIZE: Int = 16
        const val BIOME_NUMBER_OF_FRAMES: Int = 4

        const val SPRITE_SHEET_BLANK: UInt = 1000u
        const val SPRITE_SHEET_INVENTORY: UInt = 1001u
        const val SPRITE_SHEET_BIOME_TILES: UInt = 1002u
        const val SPRITE_SHEET_CONSTRUCTION_TILES: UInt = 1003u
        const val SPRITE_SHEET_BUILDINGS: UInt = 1004u
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
        const val SPRITE_SHEET_TENTACLES: UInt = 1021u
        const val SPRITE_SHEET_WEAPONS: UInt = 1022u
        const val SPRITE_SHEET_MONSTERS: UInt = 1023u
        const val SPRITE_SHEET_HEROES: UInt = 1024u
        const val SPRITE_SHEET_DEMON_LORD_DEFEAT: UInt = 1020u

        init {
            System.loadLibrary("game_core")
            System.loadLibrary("native-lib")
        }
    }
}