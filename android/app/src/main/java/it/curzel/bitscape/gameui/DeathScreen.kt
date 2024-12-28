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
import it.curzel.bitscape.gamecore.MatchResult
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch

@Composable
fun DeathScreen(
    gameEngine: GameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { DeathScreenViewModel(gameEngine) }
    val isVisible by viewModel.isVisible.collectAsState()
    val title by viewModel.title.collectAsState()
    val message by viewModel.message.collectAsState()
    val winner by viewModel.winner.collectAsState()

    DeathScreen(
        isVisible = isVisible,
        tryAgain = { viewModel.tryAgain() },
        title = title,
        message = message,
        winner = winner,
        modifier = modifier
    )
}

@Composable
fun DeathScreen(
    isVisible: Boolean,
    tryAgain: () -> Unit,
    title: Int,
    message: Int,
    winner: Int,
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
                    text = stringResource(id = title).replace("%PLAYER_NAME%", "${winner + 1}"),
                    style = DSTypography.largeTitle,
                    color = Color.White
                )
                Text(
                    text = stringResource(id = message).replace("%PLAYER_NAME%", "${winner + 1}"),
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

    private val _title = MutableStateFlow(R.string.dots)
    val title: StateFlow<Int> = _title.asStateFlow()

    private val _message = MutableStateFlow(R.string.dots)
    val message: StateFlow<Int> = _message.asStateFlow()

    private val _winner = MutableStateFlow(0)
    val winner: StateFlow<Int> = _winner.asStateFlow()

    init {
        viewModelScope.launch {
            observeGameOver()
        }
    }

    private suspend fun observeGameOver() {
        gameEngine.gameState
            .mapNotNull { it?.matchResult }
            .distinctUntilChanged()
            .collect { handle(it) }
    }

    private fun handle(result: MatchResult) {
        when (true) {
            result.inProgress -> {
                _isVisible.value = false
                _title.value = R.string.dots
                _message.value = R.string.dots
            }
            result.gameOver -> {
                _isVisible.value = true
                _title.value = R.string.death_screen_title
                _message.value = R.string.death_screen_subtitle
            }
            result.unknownWinner -> {
                _isVisible.value = true
                _title.value = R.string.death_screen_unknown_winner_title
                _message.value = R.string.death_screen_unknown_winner_subtitle
            }
            else -> {
                _winner.value = result.winner.toInt()
                _isVisible.value = true
                _title.value = R.string.death_screen_winner_title
                _message.value = R.string.death_screen_winner_subtitle
            }
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
        tryAgain = {},
        title = R.string.death_screen_title,
        message = R.string.death_screen_subtitle,
        winner = 0
    )
}

@Preview(showBackground = true)
@Composable
fun DeathScreenPlayer2WinsPreview() {
    DeathScreen(
        isVisible = true,
        tryAgain = {},
        title = R.string.death_screen_winner_title,
        message = R.string.death_screen_winner_subtitle,
        winner = 1
    )
}
