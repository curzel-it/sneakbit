import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import it.curzel.bitscape.R
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.engine.MockGameEngine
import it.curzel.bitscape.engine.SomeGameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.systemBars

@Composable
fun DeathScreen(
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { DeathScreenViewModel(gameEngine) }
    val isVisible by viewModel.isVisible.collectAsState()

    AnimatedVisibility(
        visible = isVisible,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.7f))
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.fillMaxSize()
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(50.dp)
            ) {
                Text(
                    text = stringResource(id = R.string.death_screen_title),
                    style = DSTypography.largeTitle,
                    color = Color.White
                )
                Text(
                    text = stringResource(id = R.string.death_screen_subtitle),
                    style = DSTypography.title,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .height(60.dp)
                        .clickable { viewModel.tryAgain() }
                )
            }
        }
    }
}

class DeathScreenViewModel(private val gameEngine: SomeGameEngine) : ViewModel() {
    private val _isVisible = gameEngine.showsDeathScreen()
    val isVisible: kotlinx.coroutines.flow.StateFlow<Boolean> = _isVisible

    fun tryAgain() {
        gameEngine.setKeyDown(EmulatedKey.CONFIRM)
    }
}

@Preview(showBackground = true)
@Composable
fun DeathScreenPreview() {
    DeathScreen(gameEngine = MockGameEngine())
}
