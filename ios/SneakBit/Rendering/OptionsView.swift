import Foundation
import SwiftUI
import Schwifty

struct OptionsView: View {
    @StateObject var viewModel = OptionsViewModel()
    
    var body: some View {
        if viewModel.isVisible {
            ZStack {
                Rectangle()
                    .foregroundStyle(Color.black.opacity(0.7))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                
                if viewModel.showNewGameAlert {
                    NewGameView()
                } else if viewModel.showCredits {
                    CreditsView()
                } else {
                    OptionsContent()
                }
            }
            .environmentObject(viewModel)
        } else {
            Image("menu_button_up")
                .interpolation(.none)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: KeyEmulatorView.size.width, height: KeyEmulatorView.size.height)
                .contentShape(Rectangle())
                .opacity(viewModel.menuButtonOpacity)
                .onTapGesture { viewModel.showMenu() }
                .positioned(.trailingTop)
                .padding(.trailing, viewModel.safeAreaInsets.right)
                .padding(.top, viewModel.safeAreaInsets.top)
                .padding()
        }
    }
}

private struct OptionsContent: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    var body: some View {
        ZStack {
            VStack(spacing: 60) {
                Text("game_menu_title".localized())
                    .typography(.largeTitle)
                    .foregroundStyle(Color.white)
                
                Text("game_menu_resume".localized())
                    .onTapGesture {
                        viewModel.resumeGame()
                    }
                
                Text(viewModel.toggleSoundEffectsTitle)
                    .onTapGesture {
                        viewModel.toggleSoundEffects()
                    }
                
                Text(viewModel.toggleMusicTitle)
                    .onTapGesture {
                        viewModel.toggleMusic()
                    }
                
                Text("credits".localized())
                    .onTapGesture {
                        viewModel.openCredits()
                    }
            }
            .positioned(.middle)
            
            Text("new_game".localized())
                .foregroundStyle(Color.red)
                .onTapGesture {
                    viewModel.askForNewGame()
                }
                .positioned(.bottom)
                .padding(.bottom, viewModel.safeAreaInsets.bottom + 20)
        }
        .typography(.title)
        .foregroundStyle(Color.white.opacity(0.9))
    }
}

private struct CreditsView: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    var body: some View {
        VStack(spacing: 50) {
            Text("credits".localized())
                .typography(.largeTitle)
            
            CreditsItem(key: "developer")
            CreditsItem(key: "open_source")
            CreditsItem(key: "music")
            CreditsItem(key: "sound_effects")
            
            Text("menu_back".localized())
                .textAlign(.center)
                .onTapGesture {
                    viewModel.closeCredits()
                }
                .padding(.top)
        }
        .typography(.text)
        .foregroundStyle(Color.white)
        .positioned(.middle)
    }
}

private struct CreditsItem: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    let key: String
    
    var body: some View {
        Text("credits.\(key)".localized())
            .textAlign(.center)
            .onTapGesture {
                viewModel.visitUrl(key: "credits.\(key).link")
            }
    }
}

private struct NewGameView: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    var body: some View {
        VStack(spacing: 50) {
            Text("new_game_confirmation_title".localized())
                .typography(.largeTitle)
            
            Text("new_game_confirmation_message".localized())
                .textAlign(.center)
                .typography(.text)
            
            Text("new_game_confirm".localized())
                .foregroundStyle(Color.red)
                .onTapGesture {
                    viewModel.confirmNewGame()
                }
            
            Text("new_game_cancel".localized())
                .onTapGesture {
                    viewModel.cancelNewGame()
                }
        }
        .typography(.title)
        .foregroundStyle(Color.white)
        .positioned(.middle)
    }
}

class OptionsViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    @Inject private var audio: AudioEngine
    
    @Published var isVisible: Bool = false
    @Published var showNewGameAlert: Bool = false
    @Published var menuButtonOpacity: CGFloat = 1
    @Published var toggleSoundEffectsTitle: String = "..."
    @Published var toggleMusicTitle: String = "..."
    @Published var showCredits: Bool = false
    
    private var isBeingShown = false
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    init() {
        Task { @MainActor in
            loadToggleSoundEffectsTitle()
            loadToggleMusicTitle()
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.makeButtonSemiTransparent()
            }
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
        }
        engine.pause()
    }
    
    func resumeGame() {
        withAnimation {
            isVisible = false
        }
        isBeingShown = false
        makeButtonSemiTransparent()
        engine.resume()
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
        engine.resume()
    }
    
    func cancelNewGame() {
        withAnimation {
            showNewGameAlert = false
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
