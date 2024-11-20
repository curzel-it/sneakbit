package it.curzel.bitscape.engine

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.util.Log
import it.curzel.bitscape.R
import it.curzel.bitscape.gamecore.NativeLib

class AudioEngine(
    private val context: Context,
    private val nativeLib: NativeLib
) {
    private val TAG = "AudioEngine"
    private val soundMap: MutableMap<SoundEffect, Int> = mutableMapOf()

    private val volumeMap: Map<SoundEffect, Float> = mapOf(
        SoundEffect.StepTaken to 0.01f,
        SoundEffect.Interaction to 0.2f,
        SoundEffect.BulletBounced to 0.2f,
        SoundEffect.BulletFired to 0.3f,
        SoundEffect.WorldChange to 0.6f,
        SoundEffect.AmmoCollected to 0.6f,
    )

    private val soundEffectFilenames: Map<SoundEffect, Int> = mapOf(
        SoundEffect.DeathOfNonMonster to R.raw.sfx_deathscream_android7,
        SoundEffect.DeathOfMonster to R.raw.sfx_deathscream_human11,
        SoundEffect.SmallExplosion to R.raw.sfx_exp_short_hard8,
        SoundEffect.WorldChange to R.raw.sfx_movement_dooropen1,
        SoundEffect.StepTaken to R.raw.sfx_movement_footsteps1a,
        SoundEffect.BulletFired to R.raw.sfx_movement_jump12_landing,
        SoundEffect.BulletBounced to R.raw.sfx_movement_jump20,
        SoundEffect.HintReceived to R.raw.sfx_sound_neutral5,
        SoundEffect.KeyCollected to R.raw.sfx_sounds_fanfare3,
        SoundEffect.Interaction to R.raw.sfx_sounds_interaction9,
        SoundEffect.AmmoCollected to R.raw.sfx_sounds_interaction22,
        SoundEffect.GameOver to R.raw.sfx_sounds_negative1,
        SoundEffect.PlayerResurrected to R.raw.sfx_sounds_powerup1,
        SoundEffect.NoAmmo to R.raw.sfx_wpn_noammo3
    )

    private val soundPool: SoundPool

    init {
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_GAME)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        soundPool = SoundPool.Builder()
            .setMaxStreams(soundEffectFilenames.size)
            .setAudioAttributes(audioAttributes)
            .build()

        loadSounds()
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
        soundPool.play(
            soundId,
            volume, // left volume
            volume, // right volume
            1, // priority
            0, // loop (0 = no loop)
            1f // playback rate (1.0 = normal)
        )
    }

    fun update() {
        nativeLib.currentSoundEffects()
            .mapNotNull { SoundEffect.fromInt(it) }
            .forEach { playSound(it) }
    }

    private fun fetchSoundEffects(callback: (List<SoundEffect>) -> Unit) {
        // Example: Fetch sound effects from a queue or another source
        // For demonstration, we'll just call the callback with an empty list
        callback(emptyList())
    }

    fun release() {
        soundPool.release()
    }
}

private enum class SoundEffect {
    DeathOfNonMonster,
    DeathOfMonster,
    SmallExplosion,
    WorldChange,
    StepTaken,
    BulletFired,
    BulletBounced,
    HintReceived,
    KeyCollected,
    Interaction,
    AmmoCollected,
    GameOver,
    PlayerResurrected,
    NoAmmo;

    companion object {
        fun fromInt(value: Int): SoundEffect? {
            return when (value) {
                1 -> AmmoCollected
                2 -> KeyCollected
                3 -> BulletFired
                4 -> BulletBounced
                5 -> DeathOfMonster
                6 -> DeathOfNonMonster
                7 -> SmallExplosion
                8 -> Interaction
                9 -> NoAmmo
                10 -> GameOver
                11 -> PlayerResurrected
                12 -> WorldChange
                13 -> StepTaken
                14 -> HintReceived
                else -> null
            }
        }
    }
}