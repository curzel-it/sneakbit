package it.curzel.bitscape.engine

import android.content.Context
import android.content.SharedPreferences
import android.media.AudioAttributes
import android.media.SoundPool
import android.util.Log
import it.curzel.bitscape.R
import it.curzel.bitscape.gamecore.NativeLib
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class AudioEngine(
    private val context: Context,
    private val nativeLib: NativeLib
) {
    private val TAG = "AudioEngine"
    private val soundMap: MutableMap<SoundEffect, Int> = mutableMapOf()

    private val soundTrackVolume = 0.3f

    private val volumeMap: Map<SoundEffect, Float> = mapOf(
        SoundEffect.StepTaken to 0.01f,
        SoundEffect.BulletBounced to 0.2f,
        SoundEffect.KnifeThrown to 0.3f,
        SoundEffect.WorldChange to 0.6f,
        SoundEffect.AmmoCollected to 0.6f,
        SoundEffect.GunShot to 0.8f,
        SoundEffect.LoudGunShot to 1.0f,
        SoundEffect.SwordSlash to 0.8f,
    )

    private val soundEffectFilenames: Map<SoundEffect, Int> = mapOf(
        SoundEffect.DeathOfNonMonster to R.raw.sfx_deathscream_android7,
        SoundEffect.DeathOfMonster to R.raw.sfx_deathscream_human11,
        SoundEffect.SmallExplosion to R.raw.sfx_exp_short_hard8,
        SoundEffect.WorldChange to R.raw.sfx_movement_dooropen1,
        SoundEffect.StepTaken to R.raw.sfx_movement_footsteps1a,
        SoundEffect.KnifeThrown to R.raw.sfx_movement_jump12_landing,
        SoundEffect.BulletBounced to R.raw.sfx_movement_jump20,
        SoundEffect.HintReceived to R.raw.sfx_sound_neutral5,
        SoundEffect.KeyCollected to R.raw.sfx_sounds_fanfare3,
        SoundEffect.AmmoCollected to R.raw.sfx_sounds_interaction22,
        SoundEffect.GameOver to R.raw.sfx_sounds_negative1,
        SoundEffect.PlayerResurrected to R.raw.sfx_sounds_powerup1,
        SoundEffect.NoAmmo to R.raw.sfx_wpn_noammo3,
        SoundEffect.SwordSlash to R.raw.sfx_wpn_sword2,
        SoundEffect.GunShot to R.raw.sfx_wpn_machinegun_loop1,
        SoundEffect.LoudGunShot to R.raw.sfx_weapon_shotgun3
    )

    private val soundPool: SoundPool
    private var currentSoundTrackResId: Int? = null
    private var currentSoundTrackSoundId: Int? = null
    private var currentSoundTrackStreamId: Int? = null
    private var soundEffectsEnabled: Boolean = false
    private var musicEnabled: Boolean = false
    private val preferences: SharedPreferences = context.getSharedPreferences("AudioSettings", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(Dispatchers.IO + Job())

    init {
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_GAME)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()

        soundPool = SoundPool.Builder()
            .setMaxStreams(soundEffectFilenames.size + 20)
            .setAudioAttributes(audioAttributes)
            .build()

        loadSettings()
        setupSoundLoadingListener()

        CoroutineScope(Dispatchers.IO + Job()).launch {
            loadSounds()
        }
    }

    fun areSoundEffectsEnabled(): Boolean {
        return soundEffectsEnabled
    }

    fun toggleSoundEffects() {
        soundEffectsEnabled = !soundEffectsEnabled
        preferences.edit().putBoolean(SOUND_EFFECTS_ENABLED, soundEffectsEnabled).apply()
    }

    fun isMusicEnabled(): Boolean {
        return musicEnabled
    }

    fun toggleMusic() {
        currentSoundTrackStreamId?.let { soundPool.stop(it) }
        musicEnabled = !musicEnabled
        preferences.edit().putBoolean(MUSIC_ENABLED, musicEnabled).apply()
        updateSoundTrack()
    }

    fun update() {
        scope.launch {
            if (soundEffectsEnabled) {
                nativeLib.currentSoundEffects()
                    .mapNotNull { SoundEffect.fromInt(it) }
                    .forEach { playSound(it) }
            }
        }
    }

    fun updateSoundTrack() {
        if (!musicEnabled) {
            return
        }
        val resId = soundTrackResourceIdFromFileName(nativeLib.currentSoundTrack()) ?: return

        if (currentSoundTrackResId != resId) {
            currentSoundTrackResId = resId
            currentSoundTrackStreamId?.let { soundPool.stop(it) }
            currentSoundTrackStreamId = null

            val soundId = soundPool.load(context, resId, 1)
            currentSoundTrackSoundId = soundId
        }
    }

    private fun setupSoundLoadingListener() {
        soundPool.setOnLoadCompleteListener { soundPool, loadedSoundId, status ->
            if (status == 0 && loadedSoundId == currentSoundTrackSoundId) {
                currentSoundTrackStreamId = soundPool.play(loadedSoundId, soundTrackVolume, soundTrackVolume, 1, -1, 1f)
            }
        }
    }

    private fun soundTrackResourceIdFromFileName(filename: String): Int? {
        return when (filename) {
            "pol_the_dojo_short.mp3" -> R.raw.pol_the_dojo_short
            "pol_brave_worm_short.mp3" -> R.raw.pol_brave_worm_short
            "pol_cactus_land_short.mp3" -> R.raw.pol_cactus_land_short
            "pol_chubby_cat_short.mp3" -> R.raw.pol_chubby_cat_short
            "pol_clouds_castle_short.mp3" -> R.raw.pol_clouds_castle_short
            "pol_combat_plan_short.mp3" -> R.raw.pol_combat_plan_short
            "pol_flash_run_short.mp3" -> R.raw.pol_flash_run_short
            "pol_king_of_coins_short.mp3" -> R.raw.pol_king_of_coins_short
            "pol_magical_sun_short.mp3" -> R.raw.pol_magical_sun_short
            "pol_nuts_and_bolts_short.mp3" -> R.raw.pol_nuts_and_bolts_short
            "pol_palm_beach_short.mp3" -> R.raw.pol_palm_beach_short
            "pol_pyramid_sands_short.mp3" -> R.raw.pol_pyramid_sands_short
            "pol_spirits_dance_short.mp3" -> R.raw.pol_spirits_dance_short
            "pol_final_sacrifice_short.mp3" -> R.raw.pol_final_sacrifice_short
            "pol_code_geek_short.mp3" -> R.raw.pol_code_geek_short
            else -> null
        }
    }

    private fun loadSounds() {
        for ((effect, resId) in soundEffectFilenames) {
            val soundId = soundPool.load(context, resId, 1)
            if (soundId == 0) {
                Log.e(TAG, "Failed to load sound for effect: $effect")
            } else {
                soundMap[effect] = soundId
                Log.d(TAG, "Loaded sound for effect: $effect with SoundID: $soundId")
            }
        }
    }

    private fun playSound(effect: SoundEffect) {
        val soundId = soundMap[effect]
        if (soundId == null) {
            Log.e(TAG, "No sound loaded for effect: ${effect.name}")
            return
        }

        val volume = volumeMap[effect] ?: 0.8f
        soundPool.play(soundId, volume, volume, 1, 0, 1f)
    }

    private fun loadSettings() {
        soundEffectsEnabled = preferences.getBoolean(SOUND_EFFECTS_ENABLED, true)
        musicEnabled = preferences.getBoolean(MUSIC_ENABLED, true)
    }

    fun pauseMusic() {
        currentSoundTrackStreamId?.let {
            soundPool.pause(it)
            Log.d(TAG, "Music paused")
        }
    }

    fun resumeMusic() {
        if (musicEnabled && currentSoundTrackSoundId != null) {
            currentSoundTrackStreamId = soundPool.play(
                currentSoundTrackSoundId!!,
                soundTrackVolume,
                soundTrackVolume,
                1,
                -1,
                1f
            )
            Log.d(TAG, "Music resumed")
        }
    }

    fun release() {
        soundPool.release()
        Log.d(TAG, "SoundPool released")
    }

    companion object {
        const val MUSIC_ENABLED = "kMusicEnabled"
        const val SOUND_EFFECTS_ENABLED = "kSoundEffectsEnabled"
    }
}

private enum class SoundEffect {
    AmmoCollected,
    KeyCollected,
    KnifeThrown,
    BulletBounced,
    DeathOfMonster,
    DeathOfNonMonster,
    SmallExplosion,
    NoAmmo,
    GameOver,
    PlayerResurrected,
    WorldChange,
    StepTaken,
    HintReceived,
    SwordSlash,
    GunShot,
    LoudGunShot;

    companion object {
        fun fromInt(value: Int): SoundEffect? {
            return when (value) {
                1 -> AmmoCollected
                2 -> KeyCollected
                3 -> KnifeThrown
                4 -> BulletBounced
                5 -> DeathOfMonster
                6 -> DeathOfNonMonster
                7 -> SmallExplosion
                8 -> NoAmmo
                9 -> GameOver
                10 -> PlayerResurrected
                11 -> WorldChange
                12 -> StepTaken
                13 -> HintReceived
                14 -> SwordSlash
                15 -> GunShot
                16 -> LoudGunShot
                else -> null
            }
        }
    }
}
