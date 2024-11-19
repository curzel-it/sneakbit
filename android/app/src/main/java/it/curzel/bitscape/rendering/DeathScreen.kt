import android.graphics.Paint.Align
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import it.curzel.bitscape.R
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.engine.MockGameEngine
import it.curzel.bitscape.engine.SomeGameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

@Composable
fun DeathScreen(
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { DeathScreenViewModel(gameEngine) }
    val isVisible by viewModel.isVisible.collectAsState()
    val showNewGameAlert by viewModel.showNewGameAlert.collectAsState()

    DeathScreen(
        isVisible = isVisible,
        showNewGameAlert = showNewGameAlert,
        tryAgain = { viewModel.tryAgain() },
        askForNewGame = { viewModel.askForNewGame() },
        confirmNewGame = { viewModel.confirmNewGame() },
        cancelNewGame = { viewModel.cancelNewGame() },
        modifier = modifier
    )
}

@Composable
fun DeathScreen(
    isVisible: Boolean,
    showNewGameAlert: Boolean,
    tryAgain: () -> Unit,
    askForNewGame: () -> Unit,
    confirmNewGame: () -> Unit,
    cancelNewGame: () -> Unit,
    modifier: Modifier = Modifier
) {

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
            if (showNewGameAlert) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.5f)),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        modifier = Modifier,
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(40.dp)
                    ) {
                        Text(
                            text = stringResource(id = R.string.new_game_confirmation_title),
                            style = DSTypography.largeTitle,
                            color = Color.White
                        )
                        Text(
                            text = stringResource(id = R.string.new_game_confirmation_message),
                            style = DSTypography.text,
                            color = Color.White,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 8.dp)
                        )
                        Text(
                            text = stringResource(id = R.string.new_game_confirm),
                            style = DSTypography.menuOption,
                            color = Color.Red,
                            modifier = Modifier
                                .clickable { confirmNewGame() }
                        )
                        Text(
                            text = stringResource(id = R.string.new_game_cancel),
                            style = DSTypography.menuOption,
                            color = Color.White,
                            modifier = Modifier
                                .clickable { cancelNewGame() }
                        )
                    }
                }
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.5f)),
                    contentAlignment = Alignment.Center
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
                                .clickable { tryAgain() }
                        )
                    }
                    Box(
                        modifier = Modifier.fillMaxHeight().padding(bottom = 30.dp),
                        contentAlignment = Alignment.BottomCenter
                    ) {
                        Text(
                            text = stringResource(id = R.string.new_game),
                            style = DSTypography.menuOption,
                            color = Color.Red,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .clickable { askForNewGame() }
                        )
                    }
                }
            }
        }
    }
}

class DeathScreenViewModel(private val gameEngine: SomeGameEngine) : ViewModel() {
    val isVisible: StateFlow<Boolean> = gameEngine.showsDeathScreen()

    private val _showNewGameAlert = MutableStateFlow(false)
    val showNewGameAlert: StateFlow<Boolean> = _showNewGameAlert

    fun tryAgain() {
        gameEngine.setKeyDown(EmulatedKey.CONFIRM)
    }

    fun askForNewGame() {
        _showNewGameAlert.value = true
    }

    fun confirmNewGame() {
        _showNewGameAlert.value = false
        gameEngine.startNewGame()
    }

    fun cancelNewGame() {
        _showNewGameAlert.value = false
    }
}

@Preview(showBackground = true)
@Composable
fun DeathScreenPreview() {
    DeathScreen(
        isVisible = true,
        showNewGameAlert = false,
        tryAgain = {},
        askForNewGame = {},
        confirmNewGame = {},
        cancelNewGame = {}
    )
}

@Preview(showBackground = true)
@Composable
fun DeathScreenNewGamePreview() {
    DeathScreen(
        isVisible = true,
        showNewGameAlert = true,
        tryAgain = {},
        askForNewGame = {},
        confirmNewGame = {},
        cancelNewGame = {}
    )
}
