import SwiftUI
import AVFoundation
import Schwifty

class AudioEngine: Loggable {
    private(set) var soundEffectsEnabled: Bool = true
    private(set) var musicEnabled: Bool = true
    
    private let soundTrackVolume: Float = 0.3
    private var soundPlayers: [SoundEffect: AVAudioPlayer] = [:]
    private var soundTrackPlayer: AVAudioPlayer?
    private var currentSoundTrackFileName: String?
    
    private let queue = DispatchQueue(label: "it.curzel.bitscape.AudioEngine", qos: .userInitiated)
    
    private let soundEffectFilenames = [
        SoundEffect_AmmoCollected: "sfx_sounds_interaction22",
        SoundEffect_KeyCollected: "sfx_sounds_fanfare3",
        SoundEffect_BulletFired: "sfx_movement_jump12_landing",
        SoundEffect_BulletBounced: "sfx_movement_jump20",
        SoundEffect_DeathOfMonster: "sfx_deathscream_human11",
        SoundEffect_DeathOfNonMonster: "sfx_deathscream_android7",
        SoundEffect_SmallExplosion: "sfx_exp_short_hard8",
        SoundEffect_NoAmmo: "sfx_wpn_noammo3",
        SoundEffect_GameOver: "sfx_sounds_negative1",
        SoundEffect_PlayerResurrected: "sfx_sounds_powerup1",
        SoundEffect_WorldChange: "sfx_movement_dooropen1",
        SoundEffect_StepTaken: "sfx_movement_footsteps1a",
        SoundEffect_HintReceived: "sfx_sound_neutral5",
        SoundEffect_SwordSlash: "sfx_wpn_sword2.mp3"
    ]
    
    init() {
        loadSettings()
        
        DispatchQueue.global().async {
            self.loadSounds()
        }
    }
    
    func update() {
        guard soundEffectsEnabled else { return }
        
        fetchSoundEffects { soundEffects in
            for effect in soundEffects {
                self.playSound(effect)
            }
        }
    }
    
    func updateSoundTrack() {
        guard musicEnabled else { return }
        
        let next = currentSoundTrack()
        guard next != "" && next != currentSoundTrackFileName else { return }
        
        currentSoundTrackFileName = next
        soundTrackPlayer?.stop()
        soundTrackPlayer = nil
        
        if let player = createAudioPlayer(for: next) {
            player.numberOfLoops = 100
            player.volume = 0.0
            player.setVolume(soundTrackVolume, fadeDuration: 1.5)
            player.prepareToPlay()
            player.play()
            soundTrackPlayer = player
        }
    }
    
    func toggleSoundEffects() {
        soundEffectsEnabled.toggle()
        UserDefaults.standard.set(soundEffectsEnabled, forKey: kSoundEffectsEnabled)
    }
    
    func toggleMusic() {
        soundTrackPlayer?.stop()
        soundTrackPlayer = nil
        musicEnabled.toggle()
        UserDefaults.standard.set(musicEnabled, forKey: kMusicEnabled)
        updateSoundTrack()
    }
    
    private func loadSettings() {
        let isFirstTime = UserDefaults.standard.value(forKey: kSoundEffectsEnabled) == nil
        
        if isFirstTime {
            UserDefaults.standard.set(true, forKey: kSoundEffectsEnabled)
            UserDefaults.standard.set(true, forKey: kMusicEnabled)
            soundEffectsEnabled = true
            musicEnabled = true
        } else {
            soundEffectsEnabled = UserDefaults.standard.bool(forKey: kSoundEffectsEnabled)
            musicEnabled = UserDefaults.standard.bool(forKey: kMusicEnabled)
        }
    }
    
    private func loadSounds() {
        for effect in soundEffectFilenames.keys {
            if let player = createAudioPlayer(for: effect) {
                queue.async {
                    self.soundPlayers[effect] = player
                }
            } else {
                logError("Failed to load sound for effect: \(effect)")
            }
        }
    }
    
    private func createAudioPlayer(for effect: SoundEffect) -> AVAudioPlayer? {
        createAudioPlayer(for: filename(for: effect))
    }
    
    private func createAudioPlayer(for filename: String?) -> AVAudioPlayer? {
        guard let filename, !filename.isEmpty else {
            return nil
        }
        guard let url = Bundle.main.url(forResource: filename, withExtension: "mp3", subdirectory: "audio") else {
            logError("Audio file not found for \(filename)")
            return nil
        }
        
        do {
            let player = try AVAudioPlayer(contentsOf: url)
            player.prepareToPlay()
            return player
        } catch {
            logError("Error loading audio \(filename): \(error.localizedDescription)")
            return nil
        }
    }
    
    private func filename(for effect: SoundEffect) -> String? {
        soundEffectFilenames[effect]
    }
    
    private func volume(for effect: SoundEffect) -> Float {
        switch effect {
        case SoundEffect_StepTaken: 0.01
        case SoundEffect_BulletBounced: 0.2
        case SoundEffect_BulletFired: 0.3
        case SoundEffect_WorldChange, SoundEffect_AmmoCollected: 0.6
        default: 0.8
        }
    }
    
    private func playSound(_ effect: SoundEffect) {
        queue.async {
            self.playSoundNow(effect)
        }
    }
    
    private func playSoundNow(_ effect: SoundEffect) {
        guard let player = soundPlayers[effect] else {
            logError("No player found for sound effect: \(effect.rawValue)")
            return
        }
        player.currentTime = 0
        player.volume = volume(for: effect)
        player.play()
    }
}

extension SoundEffect: Hashable {}

private let kSoundEffectsEnabled = "kSoundEffectsEnabled"
private let kMusicEnabled = "kMusicEnabled"
