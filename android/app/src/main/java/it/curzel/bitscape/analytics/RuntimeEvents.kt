package it.curzel.bitscape.analytics

import kotlinx.coroutines.flow.*
import android.util.Log

class RuntimeEventsBroker {
    private val latestEvent = MutableStateFlow<RuntimeEvent>(RuntimeEvent.Loading)

    companion object {
        private const val TAG = "RuntimeEventsBroker"
    }

    fun send(event: RuntimeEvent) {
        latestEvent.value = event
        log(event.description)
    }

    fun events(): Flow<RuntimeEvent> = latestEvent.asStateFlow()

    private fun log(message: String) {
        Log.d(TAG, message)
    }
}

sealed class RuntimeEvent {
    object Loading : RuntimeEvent()
    object Launched : RuntimeEvent()
    object WillEnterForeground : RuntimeEvent()
    object DidEnterBackground : RuntimeEvent()
    object GameOver : RuntimeEvent()
    object NewGame : RuntimeEvent()
    data class WorldTransition(val source: UInt, val destination: UInt) : RuntimeEvent()

    val description: String
        get() = when (this) {
            is Loading -> "Loading..."
            is Launched -> "Launched!"
            is WillEnterForeground -> "Entering foreground"
            is DidEnterBackground -> "Entered background"
            is GameOver -> "Game Over"
            is NewGame -> "Started new game"
            is WorldTransition -> "World changed from ${source} to ${destination}"
        }
}
