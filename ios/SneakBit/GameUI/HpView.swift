import Combine
import Foundation
import SwiftUI
import Schwifty

struct HpView: View {
    @StateObject private var viewModel = HpViewModel()
    
    var body: some View {
        if viewModel.isVisible {
            Text(viewModel.text)
                .typography(viewModel.typography)
                .foregroundStyle(viewModel.textColor)
                .positioned(.bottom)
                .padding(.bottom, viewModel.safeAreaInsets.bottom + 10)
        }
    }
}

private class HpViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var isVisible: Bool = false
    @Published var text: String = ""
    @Published var textColor: Color = .white
    @Published var typography: AppFont = .text
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.gameState()
            .map { state in (state.heroHp, state.isGameOver()) }
            .sink { [weak self] (hp, gameOver) in
                withAnimation {
                    self?.update(hp: hp, gameOver: gameOver)
                }
            }
            .store(in: &disposables)
    }
    
    private func update(hp: Float32, gameOver: Bool) {
        let maxHpToShow: Float32 = gameOver ? -99.0 : 60.0
        
        if hp < maxHpToShow {
            isVisible = true
            text = String(format: "HP %0.1f%%", hp)
            textColor = hp < 30 ? .red : .white
            typography = hp < 30 ? .menuOption : .text
        } else {
            isVisible = false
            text = ""
            textColor = .white
            typography = .text
        }
    }
}
