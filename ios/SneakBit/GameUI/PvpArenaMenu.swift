import Combine
import SwiftUI

struct PvpArenaMenu: View {
    @StateObject private var viewModel = PvpArenaMenuViewModel()
    
    var body: some View {
        if viewModel.isVisible {
            ZStack {
                Rectangle()
                    .foregroundStyle(Color.black.opacity(0.7))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                
                PvpArenaContent()
            }
            .transition(.opacity)
            .animation(.easeInOut, value: viewModel.isVisible)
            .environmentObject(viewModel)
        }
    }
}

private struct PvpArenaContent: View {
    @EnvironmentObject var viewModel: PvpArenaMenuViewModel
        
    var body: some View {
        ScrollView {
            VStack {
                Text("pvp_arena_menu_title".localized())
                    .textAlign(.center)
                    .typography(.largeTitle)
                    .foregroundStyle(Color.white)
                    .padding(.top, 100)
                
                Text("pvp_arena_menu_text".localized())
                    .textAlign(.center)
                    .typography(.caption)
                    .foregroundStyle(Color.white.opacity(0.8))
                    .padding(.top)
                    .padding(.bottom, 50)
                
                PvpArenaOption(numberOfPlayers: 2)
                PvpArenaOption(numberOfPlayers: 3)
                PvpArenaOption(numberOfPlayers: 4)
                
                Text("menu_back".localized())
                    .typography(.title)
                    .foregroundStyle(Color.white)
                    .onTapGesture {
                        viewModel.closeMenu()
                    }
                    .padding(.top, 50)
            }
            .padding(.horizontal)
            .frame(maxWidth: 600)
        }
    }
}

private struct PvpArenaOption: View {
    @EnvironmentObject var viewModel: PvpArenaMenuViewModel
    
    let numberOfPlayers: Int
    
    var body: some View {
        Button(action: {
            viewModel.confirm(numberOfPlayers: UInt(numberOfPlayers))
        }) {
            Text(">> \("number_of_players_\(numberOfPlayers)".localized()) <<")
                .typography(.title)
                .foregroundStyle(Color.white)
                .padding()
        }
        .buttonStyle(PlainButtonStyle())
    }
}

class PvpArenaMenuViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var isVisible: Bool = false
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.gameState()
            .map { $0.hasRequestedPvpArena }
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] visible in
                self?.handle(visible)
            }
            .store(in: &disposables)
    }

    private func handle(_ visible: Bool) {
        withAnimation {
            isVisible = visible
        }
    }
    
    func closeMenu() {
        withAnimation {
            isVisible = false
        }
        cancel_pvp_arena_request()
        engine.resumeGame()
    }
    
    func confirm(numberOfPlayers: UInt) {
        handle_pvp_arena(numberOfPlayers)
        closeMenu()
    }
}
