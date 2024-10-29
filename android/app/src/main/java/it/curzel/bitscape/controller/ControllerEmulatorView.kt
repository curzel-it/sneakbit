import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.controller.JoystickView
import it.curzel.bitscape.controller.KeyEmulatorView
import it.curzel.bitscape.engine.GameEngine

@Composable
fun ControllerEmulatorView(
    gameEngine: GameEngine,
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
            modifier = Modifier.align(Alignment.BottomStart)
        ) {
            KeyEmulatorView(EmulatedKey.ATTACK, gameEngine)
                // .padding(bottom = KeyEmulatorView.size.height.dp)

            KeyEmulatorView(EmulatedKey.CONFIRM, gameEngine)
        }
    }
}