import Combine
import SwiftUI

struct FastTravelMenu: View {
    @StateObject private var viewModel = FastTravelMenuViewModel()
    
    var body: some View {
        if viewModel.isVisible {
            ZStack {
                Rectangle()
                    .foregroundStyle(Color.black.opacity(0.7))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                
                FastTravelContent()
            }
            .transition(.opacity)
            .animation(.easeInOut, value: viewModel.isVisible)
            .environmentObject(viewModel)
        }
    }
}

private struct FastTravelContent: View {
    @EnvironmentObject var viewModel: FastTravelMenuViewModel
    
    var body: some View {
        ScrollView {
            VStack {
                Text("fast_travel.menu.title".localized())
                    .typography(.largeTitle)
                    .foregroundStyle(Color.white)
                    .padding(.top, 100)
                
                Text("fast_travel.menu.text".localized())
                    .typography(.title)
                    .foregroundStyle(Color.white.opacity(0.8))
                    .padding(.top)
                    .padding(.bottom, 50)
                
                ForEach(viewModel.options, id: \.self) { destination in
                    FastTravelOption(destination: destination)
                }
                
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

private struct FastTravelOption: View {
    @EnvironmentObject var viewModel: FastTravelMenuViewModel
    
    let destination: FastTravelDestination
    
    var body: some View {
        Button(action: {
            viewModel.travel(to: destination)
        }) {
            Text(">> \(destination.displayName) <<")
                .typography(.title)
                .foregroundStyle(Color.white)
                .padding()
        }
        .buttonStyle(PlainButtonStyle())
    }
}

class FastTravelMenuViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var isVisible: Bool = false
    @Published var options: [FastTravelDestination] = []
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.gameState()
            .map { $0.hasRequestedFastTravel }
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] visible in
                self?.handle(visible)
            }
            .store(in: &disposables)
    }

    private func handle(_ visible: Bool) {
        if !visible {
            withAnimation {
                isVisible = false
                options = []
            }
        } else {
            fetchAvailableFastTravelDestinations { [weak self] destinations in
                withAnimation {
                    self?.isVisible = true
                    self?.options = destinations
                }
            }
        }
    }
    
    func closeMenu() {
        withAnimation {
            isVisible = false
            options = []
        }
        cancel_fast_travel()
        engine.resumeGame()
    }
    
    func travel(to destination: FastTravelDestination) {
        handle_fast_travel(destination)
        closeMenu()
    }
}

extension FastTravelDestination: Identifiable {
    public var id: UInt32 { rawValue }
}

extension FastTravelDestination: Hashable {
}

extension FastTravelDestination {
    var displayName: String {
        "location.name.\(self.rawValue)".localized()
    }
}
