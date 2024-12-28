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
                
                VStack(spacing: 100) {
                    Text(viewModel.title)
                        .typography(.largeTitle)
                        .foregroundStyle(Color.white)
                    
                    Text(viewModel.message)
                        .typography(.title)
                        .foregroundStyle(Color.accentColor)
                        .onTapGesture {
                            viewModel.tryAgain()
                        }
                }
                .positioned(.middle)
            }
        }
    }
}

private class DeathScreenViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var isVisible: Bool = false
    @Published var title: String = ""
    @Published var message: String = ""
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.gameState()
            .map { $0.match_result }
            .removeDuplicates()
            .sink { [weak self] result in
                self?.handle(result)
            }
            .store(in: &disposables)
    }
    
    func tryAgain() {
        revive()
        engine.resumeGame()
    }
    
    private func handle(_ result: CMatchResult) {
        withAnimation {
            switch true {
            case result.in_progress:
                isVisible = false
                title = ""
                message = ""
            
            case result.game_over:
                isVisible = true
                title = "death_screen_title".localized()
                message = "death_screen_subtitle".localized()
            
            case result.unknown_winner:
                isVisible = true
                title = "death_screen_unknown_winner_title".localized()
                message = "death_screen_unknown_winner_subtitle".localized()
            
            default:
                isVisible = true
                title = "death_screen_winner_title"
                    .localized()
                    .replacingOccurrences(of: "%PLAYER_NAME%", with: "\(result.winner + 1)")
                message = "death_screen_winner_subtitle"
                    .localized()
                    .replacingOccurrences(of: "%PLAYER_NAME%", with: "\(result.winner + 1)")
            }
        }
    }
}
