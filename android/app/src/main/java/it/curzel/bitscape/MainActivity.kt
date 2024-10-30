package it.curzel.bitscape

import ControllerEmulatorView
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.engine.RenderingScaleUseCase
import it.curzel.bitscape.engine.TileMapImageGenerator
import it.curzel.bitscape.engine.TileMapsStorage
import it.curzel.bitscape.engine.WorldRevisionsStorage
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.rendering.GameView
import it.curzel.bitscape.rendering.InventoryView
import it.curzel.bitscape.rendering.SpritesProvider
import it.curzel.bitscape.ui.theme.SneakBitTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val spritesProvider = buildSpritesProvider()
        val engine = buildEngine(spritesProvider)

        enableEdgeToEdge()
        setContent {
            SneakBitTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    Box(modifier = Modifier.padding(innerPadding)) {
                        GameViewComposable(
                            engine = engine,
                            spritesProvider = spritesProvider
                        )
                        ControllerEmulatorView(engine)
                        InventoryView(engine)
                    }
                }
            }
        }
    }

    private fun buildSpritesProvider(): SpritesProvider {
        return SpritesProvider(
            context = this,
            spriteSheetFileNames = hashMapOf(
                NativeLib.SPRITE_SHEET_INVENTORY to "inventory",
                NativeLib.SPRITE_SHEET_BIOME_TILES to "tiles_biome",
                NativeLib.SPRITE_SHEET_CONSTRUCTION_TILES to "tiles_constructions",
                NativeLib.SPRITE_SHEET_BUILDINGS to "buildings",
                NativeLib.SPRITE_SHEET_BASE_ATTACK to "baseattack",
                NativeLib.SPRITE_SHEET_STATIC_OBJECTS to "static_objects",
                NativeLib.SPRITE_SHEET_MENU to "menu",
                NativeLib.SPRITE_SHEET_ANIMATED_OBJECTS to "animated_objects",
                NativeLib.SPRITE_SHEET_HUMANOIDS_1X1 to "humanoids_1x1",
                NativeLib.SPRITE_SHEET_HUMANOIDS_1X2 to "humanoids_1x2",
                NativeLib.SPRITE_SHEET_HUMANOIDS_2X2 to "humanoids_2x2",
                NativeLib.SPRITE_SHEET_HUMANOIDS_2X3 to "humanoids_2x3",
                NativeLib.SPRITE_SHEET_AVATARS to "avatars",
                NativeLib.SPRITE_SHEET_FARM_PLANTS to "farm_plants"
            )
        )
    }

    private fun buildEngine(spritesProvider: SpritesProvider): GameEngine {
        return GameEngine(
            context = this,
            renderingScaleUseCase = RenderingScaleUseCase(this),
            tileMapImageGenerator = TileMapImageGenerator(spritesProvider),
            tileMapsStorage = TileMapsStorage(this),
            worldRevisionsStorage = WorldRevisionsStorage(this)
        )
    }
}

@Composable
fun GameViewComposable(
    engine: GameEngine,
    spritesProvider: SpritesProvider,
    modifier: Modifier = Modifier
) {
    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { context ->
            GameView(context).apply {
                this.engine = engine
                this.spritesProvider = spritesProvider
            }
        }
    )
}