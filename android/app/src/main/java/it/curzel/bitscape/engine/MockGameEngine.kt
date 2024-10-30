package it.curzel.bitscape.engine

import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.rendering.LoadingScreenConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

interface SomeGameEngine {
    fun setKeyDown(key: EmulatedKey)
    fun setKeyUp(key: EmulatedKey)
    fun numberOfKunais(): StateFlow<Int>
    fun showsDeathScreen(): StateFlow<Boolean>
    fun loadingScreenConfig(): StateFlow<LoadingScreenConfig>
}

class MockGameEngine: SomeGameEngine {
    override fun setKeyDown(key: EmulatedKey) {
        // ...
    }

    override fun setKeyUp(key: EmulatedKey) {
        // ...
    }

    override fun numberOfKunais(): StateFlow<Int> {
        return MutableStateFlow(12).asStateFlow()
    }

    override fun showsDeathScreen(): StateFlow<Boolean> {
        return MutableStateFlow(true).asStateFlow()
    }

    override fun loadingScreenConfig(): StateFlow<LoadingScreenConfig> {
        return MutableStateFlow(LoadingScreenConfig.worldTransition).asStateFlow()
    }
}