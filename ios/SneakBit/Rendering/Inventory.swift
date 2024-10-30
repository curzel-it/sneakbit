import Foundation
import Combine
import SwiftUI
import Schwifty

struct InventoryView: View {
    @StateObject private var viewModel = InventoryViewModel()
    
    var body: some View {
        VStack {
            NumberOfKunaisView()
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

private struct NumberOfKunaisView: View {
    @EnvironmentObject var viewModel: InventoryViewModel
        
    var body: some View {
        if viewModel.numberOfKunais > 0 {
            VStack(alignment: .trailing, spacing: 4) {
                Image("inventory_icon_kunai")
                    .resizable()
                    .interpolation(.none)
                    .frame(width: 24, height: 24)
                
                if viewModel.numberOfKunais > 1 {
                    Text("x\(viewModel.numberOfKunais)")
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
    
    @Published var numberOfKunais: Int32 = 0
    
    private var disposables = Set<AnyCancellable>()
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    init() {
        bindKunais()
    }
    
    private func bindKunais() {
        engine.kunais
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.numberOfKunais = $0 }
            .store(in: &disposables)
    }
}
