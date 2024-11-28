package it.curzel.bitscape.analytics

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import com.google.firebase.analytics.FirebaseAnalytics
import android.content.Context
import android.os.Bundle
import it.curzel.bitscape.gamecore.NativeLib

class AnalyticsService(
    private val broker: RuntimeEventsBroker,
    private val nativeLib: NativeLib,
    context: Context
) {

    private val firebaseAnalytics: FirebaseAnalytics = FirebaseAnalytics.getInstance(context)
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var job: Job? = null

    init {
        serviceScope.launch {
            delay(500)
            bindEvents()
        }
    }

    private fun bindEvents() {
        job = broker.events()
            .onEach { handle(it) }
            .launchIn(serviceScope)
    }

    private fun handle(event: RuntimeEvent) {
        event.toAnalyticsEvent(nativeLib)?.let { send(it) }
    }

    private fun send(event: AnalyticsEvent) {
        firebaseAnalytics.logEvent(event.name, event.params)
    }
}

private data class AnalyticsEvent(
    val name: String,
    val params: Bundle? = null
)

private fun RuntimeEvent.toAnalyticsEvent(nativeLib: NativeLib): AnalyticsEvent? {
    return when (this) {
        is RuntimeEvent.Loading -> AnalyticsEvent(name = "app_loading")
        is RuntimeEvent.Launched -> AnalyticsEvent(name = "app_launched")
        is RuntimeEvent.WillEnterForeground -> AnalyticsEvent(name = "will_enter_foreground")
        is RuntimeEvent.DidEnterBackground -> AnalyticsEvent(name = "did_enter_background")
        is RuntimeEvent.NewGame -> AnalyticsEvent(name = "new_game_started")
        is RuntimeEvent.GameOver -> {
            val params = Bundle().apply {
                putInt("current_world", nativeLib.currentWorldId())
                putInt("ammo_count", nativeLib.numberOfKunaiInInventory())
            }
            AnalyticsEvent(name = "game_over", params = params)
        }
        is RuntimeEvent.WorldTransition -> {
            if (source != 0u) {
                val params = Bundle().apply {
                    putInt("source", source.toInt())
                    putInt("destination", destination.toInt())
                }
                AnalyticsEvent(name = "world_transition", params = params)
            } else {
                null
            }
        }
    }
}