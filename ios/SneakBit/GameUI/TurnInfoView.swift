import Combine
import SwiftUI

struct TurnInfoView: View {
    @StateObject private var viewModel = TurnInfoViewModel()
    
    var body: some View {
        if !viewModel.prepText.isEmpty {
            Text(viewModel.prepText)
                .typography(.title)
                .shadow(color: .black, radius: 1)
                .positioned(.middle)
        }
        if !viewModel.countdown.isEmpty {
            Text(viewModel.countdown)
                .typography(.largeTitle)
                .foregroundStyle(Color.orange)
                .shadow(color: .black, radius: 2)
                .positioned(.leadingTop)
                .padding()
                .padding(.top)
        }
    }
}

private class TurnInfoViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var prepText: String = ""
    @Published var countdown: String = ""
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.gameState()
            .filter { $0.is_pvp }
            .map { TurnInfo(from: $0) }
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] turn in
                withAnimation {
                    self?.countdown = turn.countdownText()
                    self?.prepText = turn.prepText()
                }
            }
            .store(in: &disposables)
    }
}

private struct TurnInfo: Equatable {
    let playerIndex: UInt
    let isPvp: Bool
    let isTurnPrep: Bool
    let turnTimeLeft: Float32
    
    init(from gameState: GameState) {
        playerIndex = gameState.current_player_index
        isPvp = gameState.is_pvp
        isTurnPrep = gameState.is_turn_prep
        turnTimeLeft = gameState.turn_time_left
    }
    
    func prepText() -> String {
        if isTurnPrep {
            "prep_for_next_turn"
                .localized()
                .replacingOccurrences(of: "%PLAYER_NAME%", with: "\(playerIndex + 1)")
                .replacingOccurrences(of: "%TIME%", with: "\(Int(ceil(turnTimeLeft)))")
        } else {
            ""
        }
    }
    
    func countdownText() -> String {
        if isTurnPrep {
            ""
        } else {
            String(format: "%0.1f\"", turnTimeLeft)
        }
    }
}
