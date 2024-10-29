package it.curzel.bitscape.engine

import it.curzel.bitscape.controller.EmulatedKey

interface SomeGameEngine {
    fun setKeyDown(key: EmulatedKey)
    fun setKeyUp(key: EmulatedKey)
}

class MockGameEngine: SomeGameEngine {
    override fun setKeyDown(key: EmulatedKey) {
        // ...
    }

    override fun setKeyUp(key: EmulatedKey) {
        // ...
    }
}