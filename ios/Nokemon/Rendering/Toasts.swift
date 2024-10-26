import Combine
import Foundation
import SwiftUI
import Schwifty

struct ToastView: View {
    @StateObject private var viewModel = ToastViewModel()
    
    var body: some View {
        if viewModel.isVisible {
            HStack {
                if let image = viewModel.image {
                    image
                }
                Text(viewModel.text)
            }
            .padding()
            .background {
                ZStack {
                    RoundedRectangle(cornerRadius: 4)
                        .foregroundStyle(viewModel.borderColor)
                    
                    RoundedRectangle(cornerRadius: 3)
                        .foregroundStyle(viewModel.backgroundColor)
                        .padding(2)
                }
            }
            .shadow(radius: 4)
            .opacity(viewModel.opacity)
            .positioned(viewModel.position)
            .padding()
            .padding(.top, viewModel.safeAreaInsets.top)
            .padding(.trailing, viewModel.safeAreaInsets.right)
            .padding(.bottom, viewModel.safeAreaInsets.bottom)
            .padding(.leading, viewModel.safeAreaInsets.left)
        }
    }
}

private class ToastViewModel: ObservableObject {
    @Inject private var gameEngine: GameEngine
    @Inject private var spritesProvider: SpritesProvider
    
    var safeAreaInsets: UIEdgeInsets {
        gameEngine.safeAreaInsets
    }
    
    @Published var backgroundColor: Color = .black
    @Published var borderColor: Color = .black
    @Published var opacity: CGFloat = 0
    @Published var text: String = ""
    @Published var image: Image? = nil
    @Published var isVisible: Bool = false
    @Published var position: Positioning = .leadingTop

    private var disposables = Set<AnyCancellable>()
    
    init() {
        bindToasts()
    }
    
    private func bindToasts() {
        gameEngine.toast
            .compactMap { $0 }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.load(toast: $0) }
            .store(in: &disposables)
    }
    
    private func load(toast: ToastState) {
        backgroundColor = toast.background_color.asSolidColor()
        opacity = toast.background_color.opacity()
        text = string(from: toast.text) ?? "..."
        isVisible = opacity > 0.05
        position = toast.mode.rawValue == 0 ? .trailingTop : .leadingTop
        borderColor = toast.mode.rawValue == 0 ? .cyan : .yellow
        
        if let cgImage = spritesProvider.cgImage(for: toast.image.sprite_sheet_id, textureRect: toast.image.texture_frame) {
            image = Image(decorative: cgImage, scale: 1).interpolation(.none)
        }
    }
}
