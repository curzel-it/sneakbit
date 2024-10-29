package it.curzel.bitscape.controller

import androidx.annotation.DrawableRes
import it.curzel.bitscape.R

enum class EmulatedKey {
    UP,
    RIGHT,
    DOWN,
    LEFT,
    ATTACK,
    BACKSPACE,
    CONFIRM,
    ESCAPE,
    MENU;

    @get:DrawableRes
    val imageKeyUp: Int get() = when (this) {
        UP -> R.drawable.up_button_up
        RIGHT -> R.drawable.right_button_up
        DOWN -> R.drawable.down_button_up
        LEFT -> R.drawable.left_button_up
        ATTACK -> R.drawable.j_button_up
        BACKSPACE -> 0
        CONFIRM -> R.drawable.k_button_up
        ESCAPE -> 0
        MENU -> 0
    }

    @get:DrawableRes
    val imageKeyDown: Int get() = when (this) {
        UP -> R.drawable.up_button_down
        RIGHT -> R.drawable.right_button_down
        DOWN -> R.drawable.down_button_down
        LEFT -> R.drawable.left_button_down
        ATTACK -> R.drawable.j_button_down
        BACKSPACE -> 0
        CONFIRM -> R.drawable.k_button_down
        ESCAPE -> 0
        MENU -> 0
    }
}
