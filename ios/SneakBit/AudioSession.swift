//
//  AudioSession.swift
//  SneakBit
//
//  Configures the app's AVAudioSession so the web game's HTMLAudioElement
//  sounds (js/audio.js, js/music.js) actually play.
//
//  Why this is needed: an iOS app defaults to the `soloAmbient` audio session
//  category, which silences ALL WKWebView media whenever the hardware
//  ring/silent switch is on — the classic "game has no sound" trap. We switch
//  to `.playback`, which plays regardless of the silent switch like every other
//  game, and add `.mixWithOthers` so we politely layer over the user's music
//  instead of stopping it.
//

import AVFoundation

enum AudioSession {
    /// Activate a game-appropriate audio session. Safe to call once at launch.
    static func activate() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            // Non-fatal: worst case we fall back to the default (silent-switch
            // respecting) behaviour. Nothing else in the app depends on this.
            print("AudioSession: failed to activate — \(error)")
        }
    }
}
