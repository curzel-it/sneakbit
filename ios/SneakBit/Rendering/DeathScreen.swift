import Combine
import Foundation
import SwiftUI
import Schwifty

struct DeathScreen: View {
    @StateObject private var viewModel = DeathScreenViewModel()
    
    var body: some View {
        if viewModel.isVisible {
            ZStack {
                Rectangle()
                    .foregroundStyle(Color.black.opacity(0.7))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                
                if viewModel.showNewGameAlert {
                    VStack(spacing: 40) {
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
                } else {
                    VStack(spacing: 100) {
                        Text("death_screen.title".localized())
                            .typography(.largeTitle)
                            .foregroundStyle(Color.white)
                        
                        Text("death_screen.subtitle".localized())
                            .typography(.title)
                            .foregroundStyle(Color.accentColor)
                            .onTapGesture {
                                viewModel.tryAgain()
                            }
                    }
                    .positioned(.middle)
                    
                    Text("new_game".localized())
                        .typography(.menuOption)
                        .foregroundStyle(Color.red)
                        .onTapGesture {
                            viewModel.askForNewGame()
                        }
                        .positioned(.bottom)
                        .padding(.bottom, viewModel.safeAreaInsets.bottom)
                }
            }
        }
    }
}

private class DeathScreenViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var isVisible: Bool = false
    @Published var showNewGameAlert: Bool = false
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.showsDeathScreen
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isVisible in
                withAnimation {
                    self?.isVisible = isVisible
                }
            }
            .store(in: &disposables)
    }
    
    func tryAgain() {
        engine.setKeyDown(.confirm)
    }
    
    func askForNewGame() {
        withAnimation {
            showNewGameAlert = true
        }
    }
    
    func confirmNewGame() {
        withAnimation {
            showNewGameAlert = false
        }
        engine.startNewGame()
    }
    
    func cancelNewGame() {
        withAnimation {
            showNewGameAlert = false
        }
    }
}
