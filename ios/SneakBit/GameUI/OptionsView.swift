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
                } else if viewModel.showExitPvpAlert {
                    ExitPvpView()
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
                .padding(KeyEmulatorView.padding)
                .contentShape(Rectangle())
                .opacity(viewModel.menuButtonOpacity)
                .onTapGesture { viewModel.showMenu() }
                .positioned(.trailingTop)
                .padding()
        }
    }
}

private struct OptionsContent: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    var body: some View {
        ScrollView {
            VStack(spacing: .zero) {
                Text("game_menu_title".localized())
                    .typography(.largeTitle)
                    .foregroundStyle(Color.white)
                    .padding(.top, 100)
                    .padding(.bottom, 80)
                
                Text("game_menu_resume".localized())
                    .onTapGesture {
                        viewModel.resumeGame()
                    }
                    .padding(.bottom, 50)
                
                Text(viewModel.toggleSoundEffectsTitle)
                    .onTapGesture {
                        viewModel.toggleSoundEffects()
                    }
                    .padding(.bottom, 50)
                
                Text(viewModel.toggleMusicTitle)
                    .onTapGesture {
                        viewModel.toggleMusic()
                    }
                    .padding(.bottom, 50)
                
                if viewModel.canDisablePvp {
                    Text("game_menu_exit_pvp".localized())
                        .onTapGesture {
                            viewModel.askToExitPvp()
                        }
                        .padding(.bottom, 50)
                }
                
                Text("credits".localized())
                    .onTapGesture {
                        viewModel.openCredits()
                    }
                    .padding(.bottom, 50)
                
                Text("new_game".localized())
                    .foregroundStyle(Color.red)
                    .onTapGesture {
                        viewModel.askForNewGame()
                    }
                    .padding(.bottom, 80)
                
                LinksView()
                    .padding(.bottom, 50)
            }
        }
        .typography(.title)
        .foregroundStyle(Color.white.opacity(0.8))
    }
}

private struct LinksView: View {
    var body: some View {
        HStack {
            Spacer()
            ShareButton()
            Spacer()
            SocialIcon(name: "twitter", link: "https://x.com/@HiddenMugs")
            Spacer()
            SocialIcon(name: "youtube", link: "https://www.youtube.com/@HiddenMugs")
            Spacer()
            SocialIcon(name: "discord", link: "https://discord.gg/8ghfcMvs")
            Spacer()
        }
        .frame(maxWidth: 400)
        .positioned(.horizontalCenter)
    }
}

private struct SocialIcon: View {
    let name: String
    let link: String
    
    var body: some View {
        Image(name)
            .resizable()
            .frame(width: 40, height: 40)
            .clipShape(Circle())
            .onTapGesture { URL.visit(urlString: link) }
    }
}

private struct ShareButton: View {
    var body: some View {
        Image("share")
            .resizable()
            .frame(width: 40, height: 40)
            .clipShape(Circle())
            .onTapGesture {
                shareLinks()
            }
    }

    private func shareLinks() {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        guard let rootViewController = windowScene.windows.first?.rootViewController else { return }
        
        let activityViewController = UIActivityViewController(
            activityItems: ["share.text".localized()],
            applicationActivities: nil
        )
        rootViewController.present(activityViewController, animated: true, completion: nil)
    }
}

private struct CreditsView: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    var body: some View {
        VStack(spacing: 50) {
            Text("credits".localized())
                .typography(.largeTitle)
            
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
        ConfirmationView(
            title: "new_game_confirmation_title".localized(),
            message: "new_game_confirmation_message".localized(),
            confirmTitle: "new_game_confirm".localized(),
            onConfirm: viewModel.confirmNewGame,
            onCancel: viewModel.cancelNewGame
        )
    }
}

private struct ExitPvpView: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    var body: some View {
        ConfirmationView(
            title: "game_menu_exit_pvp".localized(),
            message: "game_menu_exit_pvp_are_you_sure".localized(),
            confirmTitle: "game_menu_confirm_exit_pvp".localized(),
            onConfirm: viewModel.confirmExitPvp,
            onCancel: viewModel.cancelExitPvp
        )
    }
}

private struct ConfirmationView: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    let title: String
    let message: String
    let confirmTitle: String
    let onConfirm: () -> Void
    let onCancel: () -> Void
    
    var body: some View {
        VStack(spacing: 50) {
            Text(title.localized())
                .typography(.largeTitle)
            
            Text(message.localized())
                .textAlign(.center)
                .typography(.text)
            
            Text(confirmTitle.localized())
                .foregroundStyle(Color.red)
                .onTapGesture {
                    onConfirm()
                }
            
            Text("menu_back".localized())
                .onTapGesture {
                    onCancel()
                }
        }
        .typography(.title)
        .foregroundStyle(Color.white)
        .positioned(.middle)
    }
}

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
