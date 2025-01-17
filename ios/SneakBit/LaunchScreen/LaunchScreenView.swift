import Combine
import SwiftUI

struct LaunchScreenView: View {
    @StateObject private var viewModel = LaunchScreenViewModel()
    
    var body: some View {
        if viewModel.isVisible {
            ZStack {
                Image("logo_launch_screen")
                    .pixelArt()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 200)
                    .positioned(.middle)
            }
            .background(Color.black)
        }
    }
}

private class LaunchScreenViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var isVisible: Bool = true
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.isLoading
            .first { !$0 }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.hide() }
            .store(in: &disposables)
    }
    
    private func hide() {
        withAnimation {
            isVisible = false
        }
    }
}
