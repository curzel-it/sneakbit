import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.platform.LocalConfiguration
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.controller.JoystickView
import it.curzel.bitscape.controller.KeyEmulatorView
import it.curzel.bitscape.engine.GameEngine

@Composable
fun ControllerEmulatorView(
    gameEngine: GameEngine,
    modifier: Modifier = Modifier
) {
    // val safeAreaInsets = remember(gameEngine) { gameEngine.safeAreaInsets }

    // Convert safeAreaInsets to Dp
    val paddingValues = PaddingValues(
        start = 0.dp, // safeAreaInsets.left.dp,
        top = 0.dp, // safeAreaInsets.top.dp,
        end = 0.dp, // safeAreaInsets.right.dp,
        bottom = 80.dp // (safeAreaInsets.bottom + 80).dp // Adding extra bottom padding
    )

    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(paddingValues)
    ) {
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