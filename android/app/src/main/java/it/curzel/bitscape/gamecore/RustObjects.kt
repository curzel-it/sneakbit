package it.curzel.bitscape.gamecore

data class GameState(
    val toasts: DisplayableToast?,
    val messages: DisplayableMessage?,
    val isInteractionAvailable: Boolean,
    val matchResult: MatchResult,
    val hp: Float,
    val hasRequestedFastTravel: Boolean,
    val hasRequestedPvpArena: Boolean,
    val currentPlayerIndex: Int,
    val isPvp: Boolean,
    val isTurnPrep: Boolean,
    val turnTimeLeft: Float,
) {
    fun isGameOver(): Boolean {
        return matchResult.gameOver
    }

    fun shouldPauseGame(): Boolean {
        return isGameOver() || messages != null || hasRequestedFastTravel || hasRequestedPvpArena
    }
}

data class AmmoRecap(
    val weaponName: String,
    val weaponSpeciesId: Int,
    val weaponSprite: IntRect,
    val weaponInventorySprite: IntRect,
    val bulletBpeciesId: Int,
    val ammoInventoryCount: Int,
    val isMelee: Boolean,
    val isRanged: Boolean,
    val isEquipped: Boolean,
    val receivedDamageReduction: Float
) {
    companion object {
        val empty: AmmoRecap = AmmoRecap(
            weaponName = "",
            weaponSpeciesId = 0,
            weaponSprite = IntRect(0, 0, 0, 0),
            weaponInventorySprite = IntRect(0, 0, 0, 0),
            bulletBpeciesId = 0,
            ammoInventoryCount = 0,
            isMelee = false,
            isRanged = false,
            isEquipped = false,
            receivedDamageReduction = 0.0f
        )
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

data class MatchResult(
    val winner: UInt,
    val unknownWinner: Boolean,
    val gameOver: Boolean,
    val inProgress: Boolean
)

data class DisplayableToast(
    val text: String,
    val mode: Mode,
    val duration: Float,
    val image: Image?
) {
    data class Image(
        val spriteSheetId: UInt,
        val textureFrame: IntRect
    )

    enum class Mode(val value: Int) {
        Regular(0),
        Hint(1),
        LongHint(2);

        companion object {
            private val map = entries.associateBy(Mode::value)

            @JvmStatic
            fun fromInt(type: Int) = map[type] ?: Regular
        }
    }

    fun isHint(): Boolean {
        return when (mode) {
            Mode.Hint -> true
            Mode.LongHint -> true
            else -> false
        }
    }
}

data class DisplayableMessage(
    val title: String,
    val text: String
)