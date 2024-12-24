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
            .opacity(viewModel.isVisible ? 1 : 0)
            .positioned(.middle)
    }
}

private class LoadingScreenViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var isVisible: Bool = true
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.isLoading
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.apply(isLoading: $0) }
            .store(in: &disposables)
    }
    
    private func apply(isLoading: Bool) {
        withAnimation(isLoading ? .none : .linear) {
            isVisible = isLoading
        }
    }
}
