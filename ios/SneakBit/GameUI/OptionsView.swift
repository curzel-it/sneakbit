import Combine
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
                } else if viewModel.showSwitchWeapon {
                    SwitchWeaponView()
                        .environmentObject(viewModel)
                } else {
                    OptionsContent()
                        .environmentObject(viewModel)
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
                
                // Conditionally show "Switch Weapon" as the first option
                if viewModel.canShowSwitchWeapon {
                    Button("switch_weapon".localized()) {
                        viewModel.showWeaponSelection()
                    }
                    .buttonStyle(.menuOption)
                    .padding(.bottom, 20)
                }
                
                Button("game_menu_resume".localized()) {
                    viewModel.resumeGame()
                }
                .buttonStyle(.menuOption)
                .padding(.bottom, 20)
                
                Button(viewModel.toggleSoundEffectsTitle) {
                    viewModel.toggleSoundEffects()
                }
                .buttonStyle(.menuOption)
                .padding(.bottom, 20)
                
                Button(viewModel.toggleMusicTitle) {
                    viewModel.toggleMusic()
                }
                .buttonStyle(.menuOption)
                .padding(.bottom, 20)
                
                if viewModel.canDisablePvp {
                    Button("game_menu_exit_pvp".localized()) {
                        viewModel.askToExitPvp()
                    }
                    .buttonStyle(.menuOption)
                    .padding(.bottom, 20)
                }
                
                Button("credits".localized()) {
                    viewModel.openCredits()
                }
                .buttonStyle(.menuOption)
                .padding(.bottom, 50)
                
                Button("new_game".localized()) {
                    viewModel.askForNewGame()
                }
                .buttonStyle(.destructiveMenuOption)
                .padding(.bottom, 80)
                
                LinksView()
                    .padding(.bottom, 50)
            }
            .padding(.horizontal, 20)
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
            
            Button("menu_back".localized()) {
                viewModel.closeCredits()
            }
            .buttonStyle(.menuOption)
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
            
            Button(confirmTitle.localized()) {
                onConfirm()
            }
            .buttonStyle(.destructiveMenuOption)
            
            Button("menu_back".localized()) {
                onCancel()
            }
            .buttonStyle(.menuOption)
        }
        .typography(.title)
        .foregroundStyle(Color.white)
        .positioned(.middle)
    }
}
