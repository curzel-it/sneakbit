import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.controller.JoystickView
import it.curzel.bitscape.controller.KeyEmulatorView
import it.curzel.bitscape.engine.MockGameEngine
import it.curzel.bitscape.engine.SomeGameEngine

@Composable
fun ControllerEmulatorView(
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    val configuration = LocalConfiguration.current
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

    Box(modifier = modifier.fillMaxSize()) {
        JoystickView(gameEngine = gameEngine)

        Row(
            horizontalArrangement = Arrangement.spacedBy(0.dp),
            verticalAlignment = Alignment.Bottom,
            modifier = Modifier
                .fillMaxHeight()
                .padding(start = if (isLandscape) 85.dp else 20.dp)
                .padding(bottom = if (isLandscape) 100.dp else 140.dp)
        ) {
            KeyEmulatorView(EmulatedKey.ATTACK, gameEngine, modifier = Modifier.padding(bottom = 30.dp))
            KeyEmulatorView(EmulatedKey.CONFIRM, gameEngine, modifier = Modifier)
        }
    }
}

@Preview(showBackground = true)
@Composable
fun ControllerEmulatorViewPreview() {
    ControllerEmulatorView(gameEngine = MockGameEngine())
}