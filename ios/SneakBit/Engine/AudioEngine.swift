import SwiftUI
import AVFoundation
import Schwifty

class AudioEngine {
    private var soundPlayers: [SoundEffect: AVAudioPlayer] = [:]
    
    private let tag = "AudioEngine"
    
    private let soundEffectFilenames = [
        SoundEffect_DeathOfNonMonster: "sfx_deathscream_android7",
        SoundEffect_DeathOfMonster: "sfx_deathscream_human11",
        SoundEffect_SmallExplosion: "sfx_exp_short_hard8",
        SoundEffect_WorldChange: "sfx_movement_dooropen1",
        SoundEffect_StepTaken: "sfx_movement_footsteps1a",
        SoundEffect_BulletFired: "sfx_movement_jump12_landing",
        SoundEffect_BulletBounced: "sfx_movement_jump20",
        SoundEffect_HintReceived: "sfx_sound_neutral5",
        SoundEffect_KeyCollected: "sfx_sounds_fanfare3",
        SoundEffect_Interaction: "sfx_sounds_interaction9",
        SoundEffect_AmmoCollected: "sfx_sounds_interaction22",
        SoundEffect_GameOver: "sfx_sounds_negative1",
        SoundEffect_PlayerResurrected: "sfx_sounds_powerup1",
        SoundEffect_NoAmmo: "sfx_wpn_noammo3"
    ]
    
    init() {
        loadSounds()
    }
    
    func update() {
        fetchSoundEffects { [weak self] soundEffects in
            for effect in soundEffects {
                self?.playSound(effect)
            }
        }
    }
    
    private func loadSounds() {
        for effect in soundEffectFilenames.keys {
            if let player = createAudioPlayer(for: effect) {
                soundPlayers[effect] = player
            } else {
                Logger.error(tag, "Failed to load sound for effect: \(effect)")
            }
        }
    }
    
    private func createAudioPlayer(for effect: SoundEffect) -> AVAudioPlayer? {
        guard let url = Bundle.main.url(forResource: filename(for: effect), withExtension: "wav", subdirectory: "audio") else {
            Logger.error(tag, "Audio file not found for \(effect)")
            return nil
        }
        
        do {
            let player = try AVAudioPlayer(contentsOf: url)
            player.prepareToPlay()
            return player
        } catch {
            Logger.error(tag, "Error loading sound \(effect.rawValue): \(error.localizedDescription)")
            return nil
        }
    }
    
    private func filename(for effect: SoundEffect) -> String? {
        soundEffectFilenames[effect]
    }
    
    private func volume(for effect: SoundEffect) -> Float {
        switch effect {
        case SoundEffect_StepTaken: 0.01
        case SoundEffect_Interaction, SoundEffect_BulletBounced:0.2
        case SoundEffect_BulletFired: 0.3
        case SoundEffect_WorldChange, SoundEffect_AmmoCollected: 0.6
        default: 0.8
        }
    }
    
    private func playSound(_ effect: SoundEffect) {
        guard let player = soundPlayers[effect] else {
            Logger.error(tag, "No player found for sound effect: \(effect.rawValue)")
            return
        }
        player.currentTime = 0
        player.volume = volume(for: effect)
        player.play()
    }
}

extension SoundEffect: Hashable {}