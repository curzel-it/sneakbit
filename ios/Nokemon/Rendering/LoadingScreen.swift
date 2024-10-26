import Combine
import Foundation
import SwiftUI
import Schwifty

struct LoadingScreen: View {
    @StateObject private var viewModel = LoadingScreenViewModel()
    
    var body: some View {
        Rectangle()
            .foregroundStyle(Color.black)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .opacity(viewModel.opacity)
    }
}

private class LoadingScreenViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var opacity: CGFloat = 0
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.showsLoadingScreen
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isVisible in
                if isVisible {
                    withAnimation(.none) {
                        self?.opacity = 1
                    }
                } else {
                    withAnimation(.linear(duration: 0.2)) {
                        self?.opacity = 0
                    }
                }
            }
            .store(in: &disposables)
    }
}
