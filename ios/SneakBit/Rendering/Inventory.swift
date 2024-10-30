import Foundation
import Combine
import SwiftUI
import Schwifty

struct InventoryView: View {
    @StateObject private var viewModel = InventoryViewModel()
    
    var body: some View {
        VStack {
            NumberOfKunaiView()
        }
        .padding()
        .positioned(.trailingTop)
        .padding(.top, viewModel.safeAreaInsets.top)
        .padding(.trailing, viewModel.safeAreaInsets.right)
        .padding(.bottom, viewModel.safeAreaInsets.bottom)
        .padding(.leading, viewModel.safeAreaInsets.left)
        .environmentObject(viewModel)
    }
}

private struct NumberOfKunaiView: View {
    @EnvironmentObject var viewModel: InventoryViewModel
        
    var body: some View {
        if viewModel.numberOfKunai > 0 {
            VStack(alignment: .trailing, spacing: 4) {
                Image("inventory_icon_kunai")
                    .resizable()
                    .interpolation(.none)
                    .frame(width: 24, height: 24)
                
                if viewModel.numberOfKunai > 1 {
                    Text("x\(viewModel.numberOfKunai)")
                        .typography(.caption)
                        .foregroundStyle(Color.orange)
                        .shadow(color: .black, radius: 1)
                }
            }
        }
    }
}

private class InventoryViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    @Inject private var spritesProvider: SpritesProvider
    
    @Published var numberOfKunai: Int32 = 0
    
    private var disposables = Set<AnyCancellable>()
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    init() {
        bindKunai()
    }
    
    private func bindKunai() {
        engine.kunai
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.numberOfKunai = $0 }
            .store(in: &disposables)
    }
}
