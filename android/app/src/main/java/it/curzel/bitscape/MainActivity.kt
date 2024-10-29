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
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.ui.theme.SneakBitTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val nativeLib = NativeLib()
        nativeLib.initializeConfig(
            baseEntitySpeed = NativeLib.TILE_SIZE * 1.8f,
            currentLang = "en",
            levelsPath = "",
            speciesPath = "",
            inventoryPath = "",
            keyValueStoragePath = "",
            localizedStringsPath = ""
        )
        nativeLib.initializeGame(false)
        val worldId = nativeLib.currentWorldId()
        Log.d("MainActivity", "Current World ID: $worldId")

        enableEdgeToEdge()
        setContent {
            SneakBitTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    Greeting(
                        name = "Android",
                        modifier = Modifier.padding(innerPadding)
                    )
                }
            }
        }
    }
}

@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
    Text(
        text = "Hello $name!",
        modifier = modifier
    )
}

@Preview(showBackground = true)
@Composable
fun GreetingPreview() {
    SneakBitTheme {
        Greeting("Android")
    }
}