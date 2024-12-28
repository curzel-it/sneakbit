package it.curzel.bitscape.gameui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.R
import it.curzel.bitscape.engine.AudioEngine
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.gamecore.AmmoRecap
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class OptionsScreenViewModel(
    private val gameEngine: GameEngine,
    private val audioEngine: AudioEngine
) : ViewModel() {

    // Existing Option States
    private val _isVisible = MutableStateFlow(false)
    val isVisible: StateFlow<Boolean> = _isVisible

    private val _showNewGameAlert = MutableStateFlow(false)
    val showNewGameAlert: StateFlow<Boolean> = _showNewGameAlert

    private val _showExitPvpAlert = MutableStateFlow(false)
    val showExitPvpAlert: StateFlow<Boolean> = _showExitPvpAlert

    private val _canExitPvp = MutableStateFlow(false)
    val canExitPvp: StateFlow<Boolean> = _canExitPvp

    private val _showCredits = MutableStateFlow(false)
    val showCredits: StateFlow<Boolean> = _showCredits

    private val _menuButtonOpacity = MutableStateFlow(1f)
    val menuButtonOpacity: StateFlow<Float> = _menuButtonOpacity

    private val _toggleSoundEffectsTitle = MutableStateFlow(R.string.dots)
    val toggleSoundEffectsTitle: StateFlow<Int> = _toggleSoundEffectsTitle

    private val _toggleMusicTitle = MutableStateFlow(R.string.dots)
    val toggleMusicTitle: StateFlow<Int> = _toggleMusicTitle

    private val _weapons = MutableStateFlow<List<AmmoRecap>>(emptyList())
    val weapons: StateFlow<List<AmmoRecap>> = _weapons

    private val _canShowSwitchWeapon = MutableStateFlow(false)
    val canShowSwitchWeapon: StateFlow<Boolean> = _canShowSwitchWeapon

    private val _showSwitchWeapon = MutableStateFlow(false)
    val showSwitchWeapon: StateFlow<Boolean> = _showSwitchWeapon

    init {
        viewModelScope.launch {
            loadToggleSoundEffectsTitle()
            loadToggleMusicTitle()
            bindWeaponSelectionVisibility()
            makeButtonSemiTransparent()
        }
    }

    // Existing Methods
    fun showMenu() {
        if (_isVisible.value) return
        _isVisible.value = true
        _canExitPvp.value = gameEngine.isPvp()
        gameEngine.pauseGame()
    }

    fun resumeGame() {
        _isVisible.value = false
        gameEngine.resumeGame()
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
        gameEngine.resumeGame()
    }

    fun cancelNewGame() {
        _showNewGameAlert.value = false
    }

    fun askForExitPvp() {
        _showExitPvpAlert.value = true
    }

    fun confirmExitPvp() {
        _isVisible.value = false
        _showExitPvpAlert.value = false
        gameEngine.exitPvp()
    }

    fun cancelExitPvp() {
        _showExitPvpAlert.value = false
    }

    fun openCredits() {
        _showCredits.value = true
    }

    fun closeCredits() {
        _showCredits.value = false
    }

    fun visitLink(context: Context, stringResId: Int) {
        viewModelScope.launch {
            val url = context.getString(stringResId)
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
    }

    private fun loadToggleSoundEffectsTitle() {
        _toggleSoundEffectsTitle.value = if (audioEngine.areSoundEffectsEnabled()) {
            R.string.game_menu_disable_sound_effects
        } else {
            R.string.game_menu_enable_sound_effects
        }
    }

    private fun loadToggleMusicTitle() {
        _toggleMusicTitle.value = if (audioEngine.isMusicEnabled()) {
            R.string.game_menu_disable_music
        } else {
            R.string.game_menu_enable_music
        }
    }

    private fun makeButtonSemiTransparent() {
        viewModelScope.launch {
            kotlinx.coroutines.delay(2000L)
            _menuButtonOpacity.value = 0.2f
        }
    }

    private fun bindWeaponSelectionVisibility() {
        viewModelScope.launch {
            gameEngine.weapons.collect {
                _weapons.value = it
                updateSwitchWeaponVisibility(it)
            }
        }
    }

    private fun updateSwitchWeaponVisibility(weapons: List<AmmoRecap>) {
        val meleeCount = weapons.count { it.isMelee }
        val rangedCount = weapons.count { it.isRanged }
        _canShowSwitchWeapon.value = meleeCount > 1 || rangedCount > 1
    }

    fun showWeaponSelection() {
        viewModelScope.launch {
            _showSwitchWeapon.value = true
        }
    }

    fun selectWeapon(weapon: AmmoRecap) {
        gameEngine.setWeaponEquippedForCurrentPlayer(weapon.weaponSpeciesId)
        _showSwitchWeapon.value = false
        resumeGame()
    }

    fun closeWeaponSelection() {
        _showSwitchWeapon.value = false
    }
}