package it.curzel.bitscape.engine

import it.curzel.bitscape.controller.EmulatedKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

interface SomeGameEngine {
    fun setKeyDown(key: EmulatedKey)
    fun setKeyUp(key: EmulatedKey)
    fun numberOfKunais(): StateFlow<Int>
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
}