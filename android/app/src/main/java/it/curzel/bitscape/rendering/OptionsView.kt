package it.curzel.bitscape.rendering

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import it.curzel.bitscape.R
import it.curzel.bitscape.controller.keyEmulatorViewPadding
import it.curzel.bitscape.engine.AudioEngine
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

@Composable
fun OptionsScreen(
    gameEngine: GameEngine,
    audioEngine: AudioEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { OptionsScreenViewModel(gameEngine, audioEngine) }

    val toggleSoundEffectsTitle by viewModel.toggleSoundEffectsTitle.collectAsState()
    val isVisible by viewModel.isVisible.collectAsState()
    val showNewGameAlert by viewModel.showNewGameAlert.collectAsState()
    val menuButtonOpacity by viewModel.menuButtonOpacity.collectAsState()

    val animatedAlpha by animateFloatAsState(
        targetValue = menuButtonOpacity,
        animationSpec = tween(durationMillis = 500), label = ""
    )

    OptionsScreen(
        toggleSoundEffectsTitle = toggleSoundEffectsTitle,
        isVisible = isVisible,
        showNewGameAlert = showNewGameAlert,
        menuButtonOpacity = animatedAlpha,
        resumeGame = { viewModel.resumeGame() },
        toggleSoundEffects = { viewModel.toggleSoundEffects() },
        askForNewGame = { viewModel.askForNewGame() },
        confirmNewGame = { viewModel.confirmNewGame() },
        cancelNewGame = { viewModel.cancelNewGame() },
        showMenu = { viewModel.showMenu() },
        modifier = modifier
    )
}

@Composable
private fun OptionsScreen(
    toggleSoundEffectsTitle: Int,
    isVisible: Boolean,
    showNewGameAlert: Boolean,
    menuButtonOpacity: Float,
    resumeGame: () -> Unit,
    toggleSoundEffects: () -> Unit,
    askForNewGame: () -> Unit,
    confirmNewGame: () -> Unit,
    cancelNewGame: () -> Unit,
    showMenu: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier.fillMaxSize()) {
        if (isVisible) {
            AnimatedVisibility(
                visible = isVisible,
                enter = fadeIn(animationSpec = tween(durationMillis = 300)),
                exit = fadeOut(animationSpec = tween(durationMillis = 300)),
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.7f))
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.fillMaxSize()
                ) {
                    if (showNewGameAlert) {
                        NewGameAlert(
                            confirmNewGame = confirmNewGame,
                            cancelNewGame = cancelNewGame
                        )
                    } else {
                        OptionsContent(
                            toggleSoundEffectsTitle = toggleSoundEffectsTitle,
                            resumeGame = resumeGame,
                            toggleSoundEffects = toggleSoundEffects,
                            askForNewGame = askForNewGame
                        )
                    }
                }
            }
        } else {
            Image(
                bitmap = ImageBitmap.imageResource(R.drawable.menu_button_up),
                contentDescription = null,
                contentScale = ContentScale.FillBounds,
                filterQuality = FilterQuality.None,
                alpha = menuButtonOpacity,
                modifier = modifier
                    .size(90.dp)
                    .padding(keyEmulatorViewPadding)
                    .clickable { showMenu() }
                    .align(Alignment.TopEnd)
                    .padding(
                        end = 16.dp,
                        top = 16.dp
                    )
            )
        }
    }
}

@Composable
private fun OptionsContent(
    toggleSoundEffectsTitle: Int,
    resumeGame: () -> Unit,
    toggleSoundEffects: () -> Unit,
    askForNewGame: () -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(40.dp),
        modifier = Modifier
            .padding(32.dp)
            .widthIn(max = 300.dp)
    ) {
        Text(
            text = stringResource(id = R.string.game_menu_title),
            style = DSTypography.largeTitle,
            color = Color.White,
            textAlign = TextAlign.Center
        )
        Text(
            text = stringResource(id = R.string.game_menu_resume),
            style = DSTypography.gameMenuOption,
            modifier = Modifier
                .clickable { resumeGame() }
                .padding(vertical = 8.dp)
        )
        Text(
            text = stringResource(id = toggleSoundEffectsTitle),
            style = DSTypography.gameMenuOption,
            modifier = Modifier
                .clickable { toggleSoundEffects() }
                .padding(vertical = 8.dp)
        )
        Text(
            text = stringResource(id = R.string.new_game),
            style = DSTypography.gameMenuOption,
            color = Color.Red,
            modifier = Modifier
                .clickable { askForNewGame() }
                .padding(vertical = 8.dp)
        )
    }
}

@Composable
private fun NewGameAlert(
    confirmNewGame: () -> Unit,
    cancelNewGame: () -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(50.dp),
        modifier = Modifier
            .background(Color.Black.copy(alpha = 0.5f))
            .padding(32.dp)
            .widthIn(max = 300.dp)
    ) {
        Text(
            text = stringResource(id = R.string.new_game_confirmation_title),
            style = DSTypography.largeTitle,
            color = Color.White,
            textAlign = TextAlign.Center
        )
        Text(
            text = stringResource(id = R.string.new_game_confirmation_message),
            style = DSTypography.text,
            color = Color.White,
            textAlign = TextAlign.Center
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

private class OptionsScreenViewModel(
    private val gameEngine: GameEngine,
    private val audioEngine: AudioEngine
) : ViewModel() {
    private val _toggleSoundEffectsTitle = MutableStateFlow(R.string.dots)
    val toggleSoundEffectsTitle: StateFlow<Int> = _toggleSoundEffectsTitle

    private val _isVisible = MutableStateFlow(false)
    val isVisible: StateFlow<Boolean> = _isVisible

    private val _showNewGameAlert = MutableStateFlow(false)
    val showNewGameAlert: StateFlow<Boolean> = _showNewGameAlert

    private val _menuButtonOpacity = MutableStateFlow(1f)
    val menuButtonOpacity: StateFlow<Float> = _menuButtonOpacity

    private val viewModelScope = kotlinx.coroutines.MainScope()

    init {
        viewModelScope.launch {
            loadToggleSoundEffectsTitle()
            delay(3000L)
            makeButtonSemiTransparent()
        }
    }

    fun showMenu() {
        if (_isVisible.value) return
        _isVisible.value = true
        gameEngine.pause()
    }

    fun resumeGame() {
        _isVisible.value = false
        gameEngine.resume()
        makeButtonSemiTransparent()
    }

    fun toggleSoundEffects() {
        audioEngine.toggleSoundEffects()
        loadToggleSoundEffectsTitle()
    }

    fun askForNewGame() {
        _showNewGameAlert.value = true
    }

    fun confirmNewGame() {
        _isVisible.value = false
        _showNewGameAlert.value = false
        gameEngine.startNewGame()
        gameEngine.resume()
    }

    fun cancelNewGame() {
        _showNewGameAlert.value = false
    }

    private fun loadToggleSoundEffectsTitle() {
        _toggleSoundEffectsTitle.value = if (audioEngine.soundEffectsEnabled) {
            R.string.game_menu_disable_sound_effects
        } else {
            R.string.game_menu_enable_sound_effects
        }
    }

    private fun makeButtonSemiTransparent() {
        _menuButtonOpacity.value = 0.1f
    }
}

@Preview(showBackground = true)
@Composable
fun OptionsScreenPreview() {
    OptionsScreen(
        toggleSoundEffectsTitle = R.string.game_menu_disable_sound_effects,
        isVisible = false,
        showNewGameAlert = false,
        menuButtonOpacity = 1.0f,
        resumeGame = {},
        toggleSoundEffects = {},
        askForNewGame = {},
        confirmNewGame = {},
        cancelNewGame = {},
        showMenu = {},
        modifier = Modifier
    )
}

@Preview(showBackground = true)
@Composable
fun OptionsContentPreview() {
    OptionsContent(
        toggleSoundEffectsTitle = R.string.game_menu_disable_sound_effects,
        resumeGame = {},
        toggleSoundEffects = {},
        askForNewGame = {}
    )
}

@Preview(showBackground = true)
@Composable
fun NewGameAlertPreview() {
    NewGameAlert(
        confirmNewGame = {},
        cancelNewGame = {}
    )
}
