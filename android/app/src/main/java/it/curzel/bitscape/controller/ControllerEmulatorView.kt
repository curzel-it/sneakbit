import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
    Box(modifier = modifier.fillMaxSize()) {
        JoystickView(
            modifier = Modifier.align(Alignment.Center),
            gameEngine = gameEngine
        )

        Row(
            horizontalArrangement = Arrangement.spacedBy(56.dp / 3),
            verticalAlignment = Alignment.Bottom,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(horizontal = 32.dp)
                .padding(bottom = 100.dp)
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