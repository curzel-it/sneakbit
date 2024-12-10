import Combine
import Foundation
import SwiftUI
import Schwifty

struct LoadingScreen: View {
    @StateObject private var viewModel = LoadingScreenViewModel()
    
    var body: some View {
        ZStack {
            Rectangle()
                .foregroundStyle(Color.black)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .opacity(viewModel.opacity)
            
            VStack {
                Text(viewModel.text)
                    .foregroundStyle(Color.white)
                    .typography(.title)
                
                if viewModel.showsActivityIndicator {
                    ProgressView()
                        .progressViewStyle(.circular)
                }
            }
            .positioned(.middle)
        }
    }
}

struct LoadingScreenConfig: Equatable {
    let isVisible: Bool
    let message: String
    let showsActivityIndicator: Bool
}

extension LoadingScreenConfig {
    static let none = LoadingScreenConfig(isVisible: false, message: "", showsActivityIndicator: false)
    static let worldTransition = LoadingScreenConfig(isVisible: true, message: "", showsActivityIndicator: false)
    static let gameSetup = LoadingScreenConfig(isVisible: true, message: "Applying updates...", showsActivityIndicator: true)
}

private class LoadingScreenViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var opacity: CGFloat = 0
    @Published var text: String = ""
    @Published var showsActivityIndicator: Bool = false
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.loadingScreenConfig
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.apply(config: $0) }
            .store(in: &disposables)
    }
    
    private func apply(config: LoadingScreenConfig) {
        withAnimation(config.isVisible ? .none : .linear) {
            opacity = config.isVisible ? 1 : 0
            text = config.message
            showsActivityIndicator = config.showsActivityIndicator
        }
    }
}
