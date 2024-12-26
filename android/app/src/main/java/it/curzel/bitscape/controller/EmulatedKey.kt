package it.curzel.bitscape.controller

import androidx.annotation.DrawableRes
import it.curzel.bitscape.R

enum class EmulatedKey {
    UP,
    RIGHT,
    DOWN,
    LEFT,
    CLOSE_RANGE_ATTACK,
    RANGED_ATTACK,
    BACKSPACE,
    CONFIRM,
    ESCAPE,
    MENU;

    @get:DrawableRes
    val imageKeyUp: Int get() = when (this) {
        CLOSE_RANGE_ATTACK -> R.drawable.close_attack_button_up
        RANGED_ATTACK -> R.drawable.kunai_button_up
        CONFIRM -> R.drawable.confirm_button_up
        else -> 0
    }

    @get:DrawableRes
    val imageKeyDown: Int get() = when (this) {
        CLOSE_RANGE_ATTACK -> R.drawable.close_attack_button_down
        RANGED_ATTACK -> R.drawable.kunai_button_down
        CONFIRM -> R.drawable.confirm_button_down
        else -> 0
    }
}
