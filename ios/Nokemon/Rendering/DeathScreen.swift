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
                    .foregroundStyle(Color.black.opacity(0.75))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                
                Text("You're Dead")
                    .typography(.largeTitle)
                    .foregroundStyle(Color.white)
                    .positioned(.middle)
            }
        }
    }
}

private class DeathScreenViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var isVisible: Bool = false
    
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
}
