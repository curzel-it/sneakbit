import Combine
import Foundation
import SwiftUI
import Schwifty

class OptionsViewModel: ObservableObject {
    @Inject private var audio: AudioEngine
    @Inject private var engine: GameEngine
    
    @Published var isVisible: Bool = false
    @Published var showNewGameAlert: Bool = false
    @Published var menuButtonOpacity: CGFloat = 1
    @Published var toggleSoundEffectsTitle: String = "..."
    @Published var toggleMusicTitle: String = "..."
    @Published var showCredits: Bool = false
    @Published var showExitPvpAlert: Bool = false
    @Published var canDisablePvp: Bool = false
    
    // New Properties for Weapon Switching
    @Published var weapons: [AmmoRecap] = []
    @Published var canShowSwitchWeapon: Bool = false
    @Published var showSwitchWeapon: Bool = false
    @Published var selectedWeapon: AmmoRecap?
    
    private var cancellables = Set<AnyCancellable>()
    private var isBeingShown = false
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    init() {
        Task { @MainActor in
            loadToggleSoundEffectsTitle()
            loadToggleMusicTitle()
            
            // Subscribe to weapons publisher
            engine.weapons()
                .sink { [weak self] weapons in
                    self?.weapons = weapons
                    self?.updateSwitchWeaponVisibility()
                }
                .store(in: &cancellables)
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.makeButtonSemiTransparent()
            }
        }
    }
    
    // Determine if "Switch Weapon" should be visible
    private func updateSwitchWeaponVisibility() {
        let meleeCount = weapons.filter { $0.is_melee }.count
        let rangedCount = weapons.filter { $0.is_ranged }.count
        canShowSwitchWeapon = meleeCount > 1 || rangedCount > 1
    }
    
    // New Methods for Weapon Switching
    func showWeaponSelection() {
        withAnimation {
            showSwitchWeapon = true
        }
    }
    
    func selectWeapon(_ weapon: AmmoRecap) {
        set_weapon_equipped(weapon.weapon_species_id, engine.currentPlayerIndex)
        showSwitchWeapon = false
    }
    
    func closeWeaponSelection() {
        withAnimation {
            showSwitchWeapon = false
        }
    }
    
    func toggleSoundEffects() {
        audio.toggleSoundEffects()
        loadToggleSoundEffectsTitle()
    }
    
    func toggleMusic() {
        audio.toggleMusic()
        loadToggleMusicTitle()
    }
    
    func showMenu() {
        guard !isBeingShown else { return }
        isBeingShown = true
        
        withAnimation {
            isVisible = true
            canDisablePvp = is_pvp()
        }
        engine.pauseGame()
    }
    
    func resumeGame() {
        withAnimation {
            isVisible = false
        }
        isBeingShown = false
        makeButtonSemiTransparent()
        engine.resumeGame()
    }
    
    func askForNewGame() {
        withAnimation {
            showNewGameAlert = true
        }
    }
    
    func confirmNewGame() {
        withAnimation {
            isVisible = false
            showNewGameAlert = false
        }
        isBeingShown = false
        engine.startNewGame()
        engine.resumeGame()
    }
    
    func cancelNewGame() {
        withAnimation {
            showNewGameAlert = false
        }
    }
    
    func askToExitPvp() {
        withAnimation {
            showExitPvpAlert = true
        }
    }
    
    func confirmExitPvp() {
        withAnimation {
            isVisible = false
            showExitPvpAlert = false
        }
        isBeingShown = false
        exit_pvp_arena()
        engine.resumeGame()
    }
    
    func cancelExitPvp() {
        withAnimation {
            showExitPvpAlert = false
        }
    }
    
    func openCredits() {
        withAnimation {
            showCredits = true
        }
    }
    
    func closeCredits() {
        withAnimation {
            showCredits = false
        }
    }
    
    func visitUrl(key: String) {
        if let url = URL(string: key.localized()) {
            UIApplication.shared.open(url)
        }
    }
    
    private func loadToggleSoundEffectsTitle() {
        let key = audio.soundEffectsEnabled ? "game_menu_disable_sound_effects" : "game_menu_enable_sound_effects"
        toggleSoundEffectsTitle = key.localized()
    }
    
    private func loadToggleMusicTitle() {
        let key = audio.musicEnabled ? "game_menu_disable_music" : "game_menu_enable_music"
        toggleMusicTitle = key.localized()
    }
    
    private func makeButtonSemiTransparent() {
        withAnimation(.easeInOut(duration: 1)) {
            menuButtonOpacity = 0.2
        }
    }
}
