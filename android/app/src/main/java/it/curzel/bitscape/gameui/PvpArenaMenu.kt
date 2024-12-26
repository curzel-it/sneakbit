package it.curzel.bitscape.gameui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.R
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.rendering.Localization
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

@Composable
fun PvpArenaScreen(
    gameEngine: GameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { PvpArenaScreenViewModel(gameEngine) }
    val isVisible by viewModel.isVisible.collectAsState()

    PvpArenaScreen(
        isVisible = isVisible,
        onSelect = { viewModel.onSelect(it) },
        onBack = { viewModel.closeMenu() },
        modifier = modifier
    )
}

@Composable
private fun PvpArenaScreen(
    isVisible: Boolean,
    onSelect: (Int) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(
        visible = isVisible,
        enter = fadeIn(animationSpec = tween(durationMillis = 300)),
        exit = fadeOut(animationSpec = tween(durationMillis = 300)),
        modifier = modifier.fillMaxSize()
    ) {
        Box(
            modifier = Modifier
                .background(Color.Black.copy(alpha = 0.7f))
                .fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            PvpArenaContent(
                onSelect = { onSelect(it) },
                onBack = { onBack() }
            )
        }
    }
}

@Composable
private fun PvpArenaContent(
    onSelect: (Int) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = modifier
            .padding(32.dp)
            .widthIn(max = 600.dp)
            .verticalScroll(rememberScrollState())
    ) {
        Text(
            text = stringResource(id = R.string.fast_travel_menu_title),
            style = DSTypography.largeTitle,
            color = Color.White,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 16.dp)
        )
        Text(
            text = stringResource(id = R.string.fast_travel_menu_text),
            style = DSTypography.title,
            color = Color.White.copy(alpha = 0.8f),
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 48.dp)
        )

        PvpArenaOption(2, onSelect)
        PvpArenaOption(3, onSelect)
        PvpArenaOption(4, onSelect)

        Spacer(modifier = Modifier.height(32.dp))
        Text(
            text = stringResource(id = R.string.menu_back),
            style = DSTypography.title,
            color = Color.White,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .clickable { onBack() }
                .padding(top = 16.dp)
        )
    }
}

@Composable
private fun PvpArenaOption(numberOfPlayers: Int, onSelect: (Int) -> Unit) {
    val text = stringResource(Localization.numberOfPlayers(numberOfPlayers))

    Text(
        text = ">> $text <<",
        textAlign = TextAlign.Center,
        style = DSTypography.title,
        color = Color.White,
        modifier = Modifier
            .height(36.dp)
            .fillMaxWidth()
            .clickable { onSelect(numberOfPlayers) }
    )
}

class PvpArenaScreenViewModel(private val gameEngine: GameEngine) : ViewModel() {
    private val _isVisible = MutableStateFlow(false)
    val isVisible: StateFlow<Boolean> = _isVisible

    init {
        viewModelScope.launch {
            gameEngine.gameState.collect {
                if (it?.hasRequestedPvpArena == true) {
                    showMenu()
                } else {
                    hideMenu()
                }
            }
        }
    }

    private fun showMenu() {
        _isVisible.value = true
        gameEngine.pauseGame()
    }

    private fun hideMenu() {
        _isVisible.value = false
    }

    fun closeMenu() {
        gameEngine.cancelPvpArena()
        hideMenu()
    }

    fun onSelect(destination: Int) {
        gameEngine.handlePvpArena(destination)
        closeMenu()
    }
}

@Preview(showBackground = true)
@Composable
fun PvpArenaScreenPreview() {
    PvpArenaScreen(
        isVisible = true,
        onSelect = {},
        onBack = {}
    )
}