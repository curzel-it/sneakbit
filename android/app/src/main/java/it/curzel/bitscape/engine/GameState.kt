package it.curzel.bitscape.engine

import it.curzel.bitscape.gamecore.DisplayableMessage
import it.curzel.bitscape.gamecore.DisplayableToast
import it.curzel.bitscape.gamecore.MatchResult

data class GameState(
    val toasts: DisplayableToast?,
    val messages: DisplayableMessage?,
    val kunai: Int,
    val isInteractionAvailable: Boolean,
    val matchResult: MatchResult,
    val heroHp: Float,
    val isSwordEquipped: Boolean,
    val hasRequestedFastTravel: Boolean
) {
    fun isGameOver(): Boolean {
        return matchResult.gameOver
    }

    fun shouldPauseGame(): Boolean {
        return isGameOver() || messages != null
    }
}
