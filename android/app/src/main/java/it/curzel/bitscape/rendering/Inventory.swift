import Foundation
import Combine
import SwiftUI
import Schwifty

struct InventoryView: View {
    @StateObject private var viewModel = InventoryViewModel()
    
    var body: some View {
        VStack {
            ForEach(viewModel.items) {
                InventoryItemView(item: $0)
            }
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

private struct InventoryItemView: View {
    @EnvironmentObject var viewModel: InventoryViewModel
    
    let item: InventoryItem
    
    var body: some View {
        if let image = viewModel.image(for: item) {
            VStack(alignment: .trailing, spacing: 4) {
                image
                    .resizable()
                    .interpolation(.none)
                    .frame(width: 24, height: 24)
                    .shadow(color: .black, radius: 1)
                
                if item.count > 1 {
                    Text("x\(item.count)")
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
    
    @Published var items: [InventoryItem] = []
    
    private var disposables = Set<AnyCancellable>()
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.inventory
            .receive(on: DispatchQueue.main)
            .map { items in
                items.filter { item in
                    item.species_id == SPECIES_KUNAI
                }
            }
            .sink { [weak self] in self?.items = $0 }
            .store(in: &disposables)
    }
    
    func image(for item: InventoryItem) -> Image? {
        let cgImage = spritesProvider.cgImage(
            for: UInt32(SPRITE_SHEET_INVENTORY),
            textureRect: item.texture_source_rect
        )
        guard let cgImage else { return nil }
        return Image(decorative: cgImage, scale: 1)
    }
}

extension InventoryItem: Identifiable {
    public var id: UInt32 {
        species_id
    }
}
