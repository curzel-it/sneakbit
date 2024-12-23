package it.curzel.bitscape.gameui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.R
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch

@Composable
fun DeathScreen(
    gameEngine: GameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { DeathScreenViewModel(gameEngine) }
    val isVisible by viewModel.isVisible.collectAsState()

    DeathScreen(
        isVisible = isVisible,
        tryAgain = { viewModel.tryAgain() },
        modifier = modifier
    )
}

@Composable
fun DeathScreen(
    isVisible: Boolean,
    tryAgain: () -> Unit,
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
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.5f))
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
        }
    }
}

class DeathScreenViewModel(private val gameEngine: GameEngine) : ViewModel() {
    private val _isVisible = MutableStateFlow(false)
    val isVisible: StateFlow<Boolean> = _isVisible.asStateFlow()

    init {
        viewModelScope.launch {
            observeGameOver()
        }
    }

    private suspend fun observeGameOver() {
        gameEngine.gameState
            .mapNotNull { it?.isGameOver() }
            .collect { isGameOver ->
                _isVisible.value = isGameOver
            }
    }

    fun tryAgain() {
        gameEngine.revive()
    }
}

@Preview(showBackground = true)
@Composable
fun DeathScreenPreview() {
    DeathScreen(
        isVisible = true,
        tryAgain = {}
    )
}

@Preview(showBackground = true)
@Composable
fun DeathScreenNewGamePreview() {
    DeathScreen(
        isVisible = true,
        tryAgain = {}
    )
}
