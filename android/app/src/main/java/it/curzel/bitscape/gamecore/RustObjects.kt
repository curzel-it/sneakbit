package it.curzel.bitscape.gamecore

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
) {
    companion object {
        @JvmStatic
        fun fromNative(
            winner: UInt,
            unknownWinner: Boolean,
            gameOver: Boolean,
            inProgress: Boolean
        ): MatchResult {
            return MatchResult(winner, unknownWinner, gameOver, inProgress)
        }
    }
}

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