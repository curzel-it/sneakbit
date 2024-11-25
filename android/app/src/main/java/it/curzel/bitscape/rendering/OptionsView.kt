package it.curzel.bitscape.rendering

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
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
    val context = LocalContext.current
    val viewModel = remember { OptionsScreenViewModel(gameEngine, audioEngine) }

    val toggleSoundEffectsTitle by viewModel.toggleSoundEffectsTitle.collectAsState()
    val toggleMusicTitle by viewModel.toggleMusicTitle.collectAsState()
    val isVisible by viewModel.isVisible.collectAsState()
    val showNewGameAlert by viewModel.showNewGameAlert.collectAsState()
    val showCredits by viewModel.showCredits.collectAsState()
    val menuButtonOpacity by viewModel.menuButtonOpacity.collectAsState()

    val animatedAlpha by animateFloatAsState(
        targetValue = menuButtonOpacity,
        animationSpec = tween(durationMillis = 500), label = ""
    )

    OptionsScreen(
        isVisible = isVisible,
        showNewGameAlert = showNewGameAlert,
        showCredits = showCredits,
        menuButtonOpacity = animatedAlpha,
        resumeGame = { viewModel.resumeGame() },
        toggleSoundEffectsTitle = toggleSoundEffectsTitle,
        toggleSoundEffects = { viewModel.toggleSoundEffects() },
        toggleMusicTitle = toggleMusicTitle,
        visitUrl = { viewModel.visitLink(context, it) },
        openCredits = { viewModel.openCredits() },
        closeCredits = { viewModel.closeCredits() },
        toggleMusic = { viewModel.toggleMusic() },
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
    toggleSoundEffects: () -> Unit,
    toggleMusicTitle: Int,
    toggleMusic: () -> Unit,
    isVisible: Boolean,
    showNewGameAlert: Boolean,
    showCredits: Boolean,
    menuButtonOpacity: Float,
    visitUrl: (Int) -> Unit,
    openCredits: () -> Unit,
    closeCredits: () -> Unit,
    resumeGame: () -> Unit,
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
                    } else if (showCredits) {
                        CreditsView(
                            visitUrl = visitUrl,
                            closeCredits = closeCredits
                        )
                    } else {
                        OptionsContent(
                            toggleMusicTitle = toggleMusicTitle,
                            toggleMusic = toggleMusic,
                            toggleSoundEffectsTitle = toggleSoundEffectsTitle,
                            toggleSoundEffects = toggleSoundEffects,
                            resumeGame = resumeGame,
                            openCredits = openCredits,
                            askForNewGame = askForNewGame
                        )
                    }
                }
            }
        } else {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding()
            ) {
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
                )
            }
        }
    }
}

@Composable
private fun OptionsContent(
    toggleMusicTitle: Int,
    openCredits: () -> Unit,
    toggleMusic: () -> Unit,
    toggleSoundEffectsTitle: Int,
    toggleSoundEffects: () -> Unit,
    resumeGame: () -> Unit,
    askForNewGame: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(40.dp),
        modifier = modifier
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
            text = stringResource(id = toggleMusicTitle),
            style = DSTypography.gameMenuOption,
            modifier = Modifier
                .clickable { toggleMusic() }
                .padding(vertical = 8.dp)
        )
        Text(
            text = stringResource(id = R.string.credits),
            style = DSTypography.gameMenuOption,
            modifier = Modifier
                .clickable { openCredits() }
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
    cancelNewGame: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(50.dp),
        modifier = modifier
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

@Composable
private fun CreditsView(
    visitUrl: (Int) -> Unit,
    closeCredits: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(50.dp),
        modifier = modifier
    ) {
        Text(
            text = stringResource(id = R.string.credits),
            style = DSTypography.largeTitle,
            color = Color.White,
            textAlign = TextAlign.Center
        )
        Text(
            text = stringResource(id = R.string.credits_developer),
            style = DSTypography.text,
            modifier = Modifier.clickable { visitUrl(R.string.credits_developer_link) }
        )
        Text(
            text = stringResource(id = R.string.credits_open_source),
            style = DSTypography.text,
            modifier = Modifier.clickable { visitUrl(R.string.credits_open_source_link) }
        )
        Text(
            text = stringResource(id = R.string.credits_music),
            style = DSTypography.text,
            modifier = Modifier.clickable { visitUrl(R.string.credits_music_link) }
        )
        Text(
            text = stringResource(id = R.string.credits_sound_effects),
            style = DSTypography.text,
            modifier = Modifier.clickable { visitUrl(R.string.credits_sound_effects_link) }
        )
        Text(
            text = stringResource(id = R.string.menu_back),
            style = DSTypography.text,
            modifier = Modifier.clickable { closeCredits() }
        )
    }
}

private class OptionsScreenViewModel(
    private val gameEngine: GameEngine,
    private val audioEngine: AudioEngine
) : ViewModel() {
    private val _toggleSoundEffectsTitle = MutableStateFlow(R.string.dots)
    val toggleSoundEffectsTitle: StateFlow<Int> = _toggleSoundEffectsTitle

    private val _toggleMusicTitle = MutableStateFlow(R.string.dots)
    val toggleMusicTitle: StateFlow<Int> = _toggleMusicTitle

    private val _isVisible = MutableStateFlow(false)
    val isVisible: StateFlow<Boolean> = _isVisible

    private val _showNewGameAlert = MutableStateFlow(false)
    val showNewGameAlert: StateFlow<Boolean> = _showNewGameAlert

    private val _showCredits = MutableStateFlow(false)
    val showCredits: StateFlow<Boolean> = _showCredits

    private val _menuButtonOpacity = MutableStateFlow(1f)
    val menuButtonOpacity: StateFlow<Float> = _menuButtonOpacity

    private val viewModelScope = kotlinx.coroutines.MainScope()

    init {
        viewModelScope.launch {
            loadToggleSoundEffectsTitle()
            loadToggleMusicTitle()
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

    fun toggleMusic() {
        audioEngine.toggleMusic()
        loadToggleMusicTitle()
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

    fun openCredits() {
        _showCredits.value = true
    }

    fun closeCredits() {
        _showCredits.value = false
    }

    fun visitLink(context: Context, stringResId: Int) {
        runCatching {
            val url = context.getString(stringResId)
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }

    private fun loadToggleMusicTitle() {
        _toggleMusicTitle.value = if (audioEngine.isMusicEnabled()) {
            R.string.game_menu_disable_music
        } else {
            R.string.game_menu_enable_music
        }
    }

    private fun loadToggleSoundEffectsTitle() {
        _toggleSoundEffectsTitle.value = if (audioEngine.areSoundEffectsEnabled()) {
            R.string.game_menu_disable_sound_effects
        } else {
            R.string.game_menu_enable_sound_effects
        }
    }

    private fun makeButtonSemiTransparent() {
        _menuButtonOpacity.value = 0.2f
    }
}

@Preview(showBackground = true)
@Composable
fun OptionsScreenPreview() {
    OptionsScreen(
        toggleSoundEffectsTitle = R.string.game_menu_disable_sound_effects,
        toggleSoundEffects = {},
        toggleMusicTitle = R.string.game_menu_disable_music,
        toggleMusic = {},
        isVisible = false,
        showNewGameAlert = false,
        showCredits = false,
        menuButtonOpacity = 1.0f,
        resumeGame = {},
        askForNewGame = {},
        confirmNewGame = {},
        cancelNewGame = {},
        openCredits = {},
        closeCredits = {},
        visitUrl = {},
        showMenu = {},
        modifier = Modifier.background(Color.Black)
    )
}

@Preview(showBackground = true)
@Composable
fun OptionsContentPreview() {
    OptionsContent(
        toggleSoundEffectsTitle = R.string.game_menu_disable_sound_effects,
        toggleSoundEffects = {},
        toggleMusicTitle = R.string.game_menu_disable_music,
        toggleMusic = {},
        resumeGame = {},
        openCredits = {},
        askForNewGame = {},
        modifier = Modifier.background(Color.Black)
    )
}

@Preview(showBackground = true)
@Composable
fun NewGameAlertPreview() {
    NewGameAlert(
        confirmNewGame = {},
        cancelNewGame = {},
        modifier = Modifier.background(Color.Black)
    )
}

@Preview(showBackground = true)
@Composable
fun CreditsPreview() {
    CreditsView(
        visitUrl = {},
        closeCredits = {},
        modifier = Modifier.background(Color.Black)
    )
}
