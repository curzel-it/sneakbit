package it.curzel.bitscape.gameui

import android.content.Context
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
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
fun FastTravelScreen(
    gameEngine: GameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { FastTravelMenuViewModel(gameEngine) }
    val isVisible by viewModel.isVisible.collectAsState()
    val options by viewModel.options.collectAsState()

    FastTravelScreen(
        isVisible = isVisible,
        options = options,
        onSelect = { viewModel.onSelect(it) },
        onBack = { viewModel.closeMenu() },
        modifier = modifier
    )
}

@Composable
private fun FastTravelScreen(
    isVisible: Boolean,
    options: List<Int>,
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
            FastTravelContent(
                options = options,
                onSelect = { onSelect(it) },
                onBack = { onBack() }
            )
        }
    }
}

@Composable
private fun FastTravelContent(
    options: List<Int>,
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
        options.forEach {
            FastTravelOption(it, onSelect)
        }
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
private fun FastTravelOption(destination: Int, onSelect: (Int) -> Unit) {
    Text(
        text = ">> ${Localization.locationName(destination)} <<",
        textAlign = TextAlign.Center,
        style = DSTypography.title,
        color = Color.White,
        modifier = Modifier
            .height(36.dp)
            .fillMaxWidth()
            .clickable { onSelect(destination) }
    )
}

class FastTravelMenuViewModel(private val gameEngine: GameEngine) : ViewModel() {
    private val _isVisible = MutableStateFlow(false)
    val isVisible: StateFlow<Boolean> = _isVisible

    private val _options = MutableStateFlow<List<Int>>(emptyList())
    val options: StateFlow<List<Int>> = _options

    init {
        viewModelScope.launch {
            gameEngine.gameState.collect {
                if (it?.hasRequestedFastTravel == true) {
                    _options.value = gameEngine.fastTravelOptions().toList()
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
        _options.value = emptyList()
    }

    fun closeMenu() {
        gameEngine.cancelFastTravel()
        hideMenu()
    }

    fun onSelect(destination: Int) {
        gameEngine.handleFastTravel(destination)
        closeMenu()
    }
}

@Preview(showBackground = true)
@Composable
fun FastTravelScreenPreview() {
    FastTravelScreen(
        isVisible = true,
        options = listOf(1001, 1003, 1013),
        onSelect = {},
        onBack = {}
    )
}