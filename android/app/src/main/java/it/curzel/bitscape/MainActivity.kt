package it.curzel.bitscape

import ControllerEmulatorView
import DeathScreen
import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.analytics.AnalyticsService
import it.curzel.bitscape.analytics.RuntimeEvent
import it.curzel.bitscape.analytics.RuntimeEventsBroker
import it.curzel.bitscape.controller.ControllerSettingsStorage
import it.curzel.bitscape.engine.AudioEngine
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.rendering.GameViewComposable
import it.curzel.bitscape.rendering.HpView
import it.curzel.bitscape.rendering.LoadingScreen
import it.curzel.bitscape.rendering.MessageView
import it.curzel.bitscape.rendering.OptionsScreen
import it.curzel.bitscape.rendering.SpritesProvider
import it.curzel.bitscape.rendering.ToastView
import it.curzel.bitscape.ui.theme.SneakBitTheme

class MainActivity : ComponentActivity() {
    private val gameViewModel: GameViewModel by viewModels()

    private val engine: GameEngine get() = gameViewModel.engine
    private val spritesProvider: SpritesProvider get() = gameViewModel.spritesProvider
    private val audioEngine: AudioEngine get() = gameViewModel.audioEngine
    private val broker: RuntimeEventsBroker get() = gameViewModel.broker

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        broker.send(RuntimeEvent.Launched)
        enableEdgeToEdge()

        setContent {
            val configuration = LocalConfiguration.current
            val density = LocalDensity.current
            val controllerSettingsStorage = ControllerSettingsStorage(
                this,
                configuration.screenWidthDp.dp,
                configuration.screenHeightDp.dp,
                density
            )

            SneakBitTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    Box {
                        Box(modifier = Modifier.padding(innerPadding)) {
                            GameViewComposable(engine, spritesProvider)
                            HpView(engine)
                            ControllerEmulatorView(engine, controllerSettingsStorage)
                        }
                        MessageView(engine)
                        OptionsScreen(engine, audioEngine)
                        LoadingScreen(engine)
                        DeathScreen(engine)
                        Box(modifier = Modifier.padding(innerPadding)) {
                            ToastView(engine, spritesProvider)
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        gameViewModel.audioEngine.resumeMusic()
        gameViewModel.broker.send(RuntimeEvent.WillEnterForeground)
    }

    override fun onPause() {
        super.onPause()
        gameViewModel.audioEngine.pauseMusic()
        gameViewModel.broker.send(RuntimeEvent.DidEnterBackground)
    }

    override fun onDestroy() {
        super.onDestroy()
        gameViewModel.audioEngine.release()
    }
}

class GameViewModel(application: Application) : AndroidViewModel(application) {
    val nativeLib: NativeLib = NativeLib()
    val broker: RuntimeEventsBroker = RuntimeEventsBroker()
    val audioEngine = AudioEngine(application, nativeLib)
    val engine = GameEngine(application, nativeLib, audioEngine, broker, viewModelScope)
    val analytics: AnalyticsService = AnalyticsService(broker, nativeLib, application)

    val spritesProvider = SpritesProvider(
        context = application,
        spriteSheetFileNames = hashMapOf(
            NativeLib.SPRITE_SHEET_INVENTORY to "inventory",
            NativeLib.SPRITE_SHEET_BIOME_TILES to "tiles_biome",
            NativeLib.SPRITE_SHEET_CONSTRUCTION_TILES to "tiles_constructions",
            NativeLib.SPRITE_SHEET_BUILDINGS to "buildings",
            NativeLib.SPRITE_SHEET_STATIC_OBJECTS to "static_objects",
            NativeLib.SPRITE_SHEET_MENU to "menu",
            NativeLib.SPRITE_SHEET_ANIMATED_OBJECTS to "animated_objects",
            NativeLib.SPRITE_SHEET_HUMANOIDS_1X1 to "humanoids_1x1",
            NativeLib.SPRITE_SHEET_HUMANOIDS_1X2 to "humanoids_1x2",
            NativeLib.SPRITE_SHEET_HUMANOIDS_2X2 to "humanoids_2x2",
            NativeLib.SPRITE_SHEET_HUMANOIDS_2X3 to "humanoids_2x3",
            NativeLib.SPRITE_SHEET_AVATARS to "avatars",
            NativeLib.SPRITE_SHEET_FARM_PLANTS to "farm_plants",
            NativeLib.SPRITE_SHEET_CAVE_DARKNESS to "cave_darkness",
            NativeLib.SPRITE_SHEET_TENTACLES to "tentacles",
            NativeLib.SPRITE_SHEET_WEAPONS to "weapons",
            NativeLib.SPRITE_SHEET_MONSTERS to "monsters",
            NativeLib.SPRITE_SHEET_HEROES to "heroes",
            NativeLib.SPRITE_SHEET_DEMON_LORD_DEFEAT to "demon_lord_defeat"
        )
    )
}