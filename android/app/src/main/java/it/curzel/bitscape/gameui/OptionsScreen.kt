package it.curzel.bitscape.gameui

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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import it.curzel.bitscape.R
import it.curzel.bitscape.controller.keyEmulatorViewPadding
import it.curzel.bitscape.engine.AudioEngine
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.rendering.SpritesProvider
import it.curzel.bitscape.ui.theme.DSTypography

@Composable
fun OptionsScreen(
    gameEngine: GameEngine,
    audioEngine: AudioEngine,
    spritesProvider: SpritesProvider,
    modifier: Modifier = Modifier
) {
    val isLandscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    val context = LocalContext.current
    val viewModel = remember { OptionsScreenViewModel(gameEngine, audioEngine) }

    val toggleSoundEffectsTitle by viewModel.toggleSoundEffectsTitle.collectAsState()
    val toggleMusicTitle by viewModel.toggleMusicTitle.collectAsState()
    val isVisible by viewModel.isVisible.collectAsState()
    val showNewGameAlert by viewModel.showNewGameAlert.collectAsState()
    val showExitPvpAlert by viewModel.showExitPvpAlert.collectAsState()
    val showCredits by viewModel.showCredits.collectAsState()
    val canExitPvp by viewModel.canExitPvp.collectAsState()

    val weapons by viewModel.weapons.collectAsState()
    val canShowSwitchWeapon by viewModel.canShowSwitchWeapon.collectAsState()
    val showSwitchWeapon by viewModel.showSwitchWeapon.collectAsState()

    val actualMenuButtonOpacity by viewModel.menuButtonOpacity.collectAsState()
    val menuButtonOpacity by animateFloatAsState(
        targetValue = actualMenuButtonOpacity,
        animationSpec = tween(durationMillis = 500), label = ""
    )

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
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(top = if (isLandscape) 10.dp else 80.dp)
                        .padding(bottom = if (isLandscape) 10.dp else 20.dp)
                ) {
                    when {
                        showNewGameAlert -> {
                            NewGameAlert(
                                confirmNewGame = { viewModel.confirmNewGame() },
                                cancelNewGame = { viewModel.cancelNewGame() }
                            )
                        }
                        showExitPvpAlert -> {
                            ExitPvpAlert(
                                confirmExitPvp = { viewModel.confirmExitPvp() },
                                cancelExitPvp = { viewModel.cancelExitPvp() }
                            )
                        }
                        showCredits -> {
                            CreditsView(
                                visitUrl = { resId -> viewModel.visitLink(context, resId) },
                                closeCredits = { viewModel.closeCredits() }
                            )
                        }
                        showSwitchWeapon -> {
                            WeaponSelectionView(
                                weapons = weapons,
                                spritesProvider = spritesProvider,
                                onSelectWeapon = { viewModel.selectWeapon(it) },
                                onClose = { viewModel.closeWeaponSelection() }
                            )
                        }
                        else -> {
                            OptionsContent(
                                toggleSoundEffectsTitle = toggleSoundEffectsTitle,
                                toggleSoundEffects = { viewModel.toggleSoundEffects() },
                                toggleMusicTitle = toggleMusicTitle,
                                toggleMusic = { viewModel.toggleMusic() },
                                resumeGame = { viewModel.resumeGame() },
                                openCredits = { viewModel.openCredits() },
                                askForNewGame = { viewModel.askForNewGame() },
                                askForExitPvp = { viewModel.askForExitPvp() },
                                canExitPvp = canExitPvp,
                                canShowSwitchWeapon = canShowSwitchWeapon,
                                showWeaponSelection = { viewModel.showWeaponSelection() }
                            )
                        }
                    }
                }
            }
        } else {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(16.dp)
            ) {
                Image(
                    bitmap = ImageBitmap.imageResource(R.drawable.menu_button_up),
                    contentDescription = null,
                    contentScale = ContentScale.FillBounds,
                    filterQuality = FilterQuality.None,
                    alpha = menuButtonOpacity,
                    modifier = Modifier
                        .size(90.dp)
                        .padding(keyEmulatorViewPadding)
                        .clickable { viewModel.showMenu() }
                )
            }
        }
    }
}

@Composable
private fun OptionsContent(
    toggleSoundEffectsTitle: Int,
    toggleSoundEffects: () -> Unit,
    toggleMusicTitle: Int,
    toggleMusic: () -> Unit,
    resumeGame: () -> Unit,
    openCredits: () -> Unit,
    askForNewGame: () -> Unit,
    askForExitPvp: () -> Unit,
    canExitPvp: Boolean,
    canShowSwitchWeapon: Boolean,
    showWeaponSelection: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp),
        modifier = modifier
            .fillMaxWidth()
            .wrapContentHeight(Alignment.CenterVertically)
            .verticalScroll(rememberScrollState())
    ) {
        Text(
            text = stringResource(id = R.string.game_menu_title),
            style = DSTypography.largeTitle,
            color = Color.White,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 30.dp)
        )
        if (canShowSwitchWeapon) {
            Text(
                text = stringResource(id = R.string.switch_weapon),
                style = DSTypography.gameMenuOption,
                modifier = Modifier
                    .padding(vertical = 12.dp)
                    .clickable { showWeaponSelection() }
            )
        }
        Text(
            text = stringResource(id = R.string.game_menu_resume),
            style = DSTypography.gameMenuOption,
            modifier = Modifier
                .padding(vertical = 12.dp)
                .clickable { resumeGame() }
        )
        Text(
            text = stringResource(id = toggleSoundEffectsTitle),
            style = DSTypography.gameMenuOption,
            modifier = Modifier
                .padding(vertical = 12.dp)
                .clickable { toggleSoundEffects() }
        )
        Text(
            text = stringResource(id = toggleMusicTitle),
            style = DSTypography.gameMenuOption,
            modifier = Modifier
                .padding(vertical = 12.dp)
                .clickable { toggleMusic() }
        )
        if (canExitPvp) {
            Text(
                text = stringResource(id = R.string.game_menu_exit_pvp),
                style = DSTypography.gameMenuOption,
                modifier = Modifier
                    .padding(vertical = 12.dp)
                    .clickable { askForExitPvp() }
            )
        }
        Text(
            text = stringResource(id = R.string.credits),
            style = DSTypography.gameMenuOption,
            modifier = Modifier
                .padding(vertical = 12.dp)
                .clickable { openCredits() }
        )
        Text(
            text = stringResource(id = R.string.new_game),
            style = DSTypography.gameMenuOption,
            color = Color.Red,
            modifier = Modifier
                .padding(vertical = 12.dp)
                .clickable { askForNewGame() }
        )
        LinksSection(modifier = Modifier.padding(top = 40.dp))
    }
}

@Composable
private fun LinksSection(modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth()) {
        Spacer(modifier = Modifier.weight(1.0f))

        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SocialIcon(
                drawableRes = R.drawable.twitter,
                link = "https://x.com/@HiddenMugs"
            )
            SocialIcon(
                drawableRes = R.drawable.youtube,
                link = "https://www.youtube.com/@HiddenMugs"
            )
            SocialIcon(
                drawableRes = R.drawable.discord,
                link = "https://discord.gg/8ghfcMvs"
            )
            ShareButton()
        }
        Spacer(modifier = Modifier.weight(1.0f))
    }
}

@Composable
private fun SocialIcon(drawableRes: Int, link: String) {
    val context = LocalContext.current
    Image(
        bitmap = ImageBitmap.imageResource(drawableRes),
        contentDescription = null,
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .clickable {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            }
    )
}

@Composable
private fun ShareButton() {
    val context = LocalContext.current
    Image(
        bitmap = ImageBitmap.imageResource(R.drawable.share),
        contentDescription = null,
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .clickable {
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, context.getString(R.string.share_text))
                }
                val chooser = Intent.createChooser(shareIntent, null)
                context.startActivity(chooser)
            }
    )
}

@Composable
private fun NewGameAlert(
    confirmNewGame: () -> Unit,
    cancelNewGame: () -> Unit,
    modifier: Modifier = Modifier
) {
    ConfirmAlert(
        title = stringResource(id = R.string.new_game_confirmation_title),
        text = stringResource(id = R.string.new_game_confirmation_message),
        confirmText = stringResource(id = R.string.new_game_confirm),
        confirm = confirmNewGame,
        cancel = cancelNewGame,
        modifier = modifier
    )
}

@Composable
private fun ExitPvpAlert(
    confirmExitPvp: () -> Unit,
    cancelExitPvp: () -> Unit,
    modifier: Modifier = Modifier
) {
    ConfirmAlert(
        title = stringResource(id = R.string.game_menu_exit_pvp),
        text = stringResource(id = R.string.game_menu_exit_pvp_are_you_sure),
        confirmText = stringResource(id = R.string.game_menu_confirm_exit_pvp),
        confirm = confirmExitPvp,
        cancel = cancelExitPvp,
        modifier = modifier
    )
}

@Composable
private fun ConfirmAlert(
    title: String,
    text: String,
    confirmText: String,
    confirm: () -> Unit,
    cancel: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(50.dp),
        modifier = modifier
    ) {
        Text(
            text = title,
            style = DSTypography.largeTitle,
            color = Color.White,
            textAlign = TextAlign.Center
        )
        Text(
            text = text,
            style = DSTypography.text,
            color = Color.White,
            textAlign = TextAlign.Center
        )
        Text(
            text = confirmText,
            style = DSTypography.menuOption,
            color = Color.Red,
            modifier = Modifier.clickable { confirm() }
        )
        Text(
            text = stringResource(id = R.string.menu_back),
            style = DSTypography.menuOption,
            color = Color.White,
            modifier = Modifier.clickable { cancel() }
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
