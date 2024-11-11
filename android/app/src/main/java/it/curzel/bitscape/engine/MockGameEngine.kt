package it.curzel.bitscape.engine

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.rendering.LoadingScreenConfig
import it.curzel.bitscape.rendering.MenuConfig
import it.curzel.bitscape.rendering.ToastConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

interface SomeGameEngine {
    fun setKeyDown(key: EmulatedKey)
    fun setKeyUp(key: EmulatedKey)
    fun numberOfKunai(): StateFlow<Int>
    fun showsDeathScreen(): StateFlow<Boolean>
    fun loadingScreenConfig(): StateFlow<LoadingScreenConfig>
    fun toastConfig(): StateFlow<ToastConfig>
    fun menuConfig(): StateFlow<MenuConfig>
    fun onMenuItemSelection(index: Int)
    fun isNight(): Boolean
    fun isLimitedVisibility(): Boolean
}

class MockGameEngine: SomeGameEngine {
    override fun setKeyDown(key: EmulatedKey) {
        // ...
    }

    override fun setKeyUp(key: EmulatedKey) {
        // ...
    }

    override fun numberOfKunai(): StateFlow<Int> {
        return MutableStateFlow(12).asStateFlow()
    }

    override fun showsDeathScreen(): StateFlow<Boolean> {
        return MutableStateFlow(true).asStateFlow()
    }

    override fun loadingScreenConfig(): StateFlow<LoadingScreenConfig> {
        return MutableStateFlow(LoadingScreenConfig.worldTransition).asStateFlow()
    }

    override fun toastConfig(): StateFlow<ToastConfig> {
        return MutableStateFlow(ToastConfig.demo).asStateFlow()
    }

    override fun menuConfig(): StateFlow<MenuConfig> {
        return MutableStateFlow(MenuConfig.demo).asStateFlow()
    }

    override fun onMenuItemSelection(index: Int) {
        // ...
    }

    override fun isNight(): Boolean {
        return false
    }

    override fun isLimitedVisibility(): Boolean {
        return false
    }
}