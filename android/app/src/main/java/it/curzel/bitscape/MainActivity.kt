package it.curzel.bitscape

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.viewinterop.AndroidView
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.rendering.GameEngine
import it.curzel.bitscape.rendering.GameView
import it.curzel.bitscape.rendering.SpritesProvider
import it.curzel.bitscape.ui.theme.SneakBitTheme
import java.io.File
import java.io.IOException

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val dataPath = AssetUtils.extractAssetFolder(this, "data", "data")
        val langPath = AssetUtils.extractAssetFolder(this, "lang", "lang")

        val nativeLib = NativeLib()
        nativeLib.testLogs()
        val result = nativeLib.testBool()
        Log.d("MainActivity", "Interop working: $result")

        nativeLib.initializeConfig(
            baseEntitySpeed = NativeLib.TILE_SIZE * 1.8f,
            currentLang = "en",
            levelsPath = dataPath,
            speciesPath = "$dataPath/species.json",
            inventoryPath = inventoryPath(),
            keyValueStoragePath = storagePath(),
            localizedStringsPath = langPath
        )
        nativeLib.initializeGame(false)
        val worldId = nativeLib.currentWorldId()
        Log.d("MainActivity", "Current World ID: $worldId")


        val engine = GameEngine()
        val spritesProvider = SpritesProvider()

        enableEdgeToEdge()
        setContent {
            SneakBitTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    GameViewComposable(
                        engine = engine,
                        spritesProvider = spritesProvider,
                        modifier = Modifier.padding(innerPadding)
                    )
                }
            }
        }
    }

    private fun inventoryPath(): String {
        val fileName = "inventory.json"
        val file = File(filesDir, fileName)
        ensureFileExists(file, "[]")
        return file.absolutePath
    }

    private fun storagePath(): String {
        val fileName = "save.json"
        val file = File(filesDir, fileName)
        ensureFileExists(file, "{}")
        return file.absolutePath
    }

    private fun ensureFileExists(file: File, defaultContents: String) {
        if (!file.exists()) {
            try {
                file.parentFile?.mkdirs()
                file.createNewFile()
                file.writeText(defaultContents)
                Log.d("MainActivity", "Created new file: ${file.absolutePath}")
            } catch (e: IOException) {
                Log.e("MainActivity", "Failed to create file: ${file.absolutePath}", e)
            }
        } else {
            Log.d("MainActivity", "File already exists: ${file.absolutePath}")
        }
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
                // Initialize any additional setup for GameView if needed
            }
        }
    )
}