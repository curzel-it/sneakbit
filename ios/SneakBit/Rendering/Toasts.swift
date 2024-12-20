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
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 24)
                        .frame(height: 24)
                }
                Text(viewModel.text)
            }
            .padding()
            .background {
                ZStack {
                    RoundedRectangle(cornerRadius: 4)
                        .foregroundStyle(viewModel.borderColor)
                    
                    RoundedRectangle(cornerRadius: 3)
                        .foregroundStyle(Color.toastBackground)
                        .padding(2)
                }
            }
            .shadow(radius: 4)
            .opacity(viewModel.isVisible ? 1 : 0)
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
    @Inject private var engine: GameEngine
    @Inject private var spritesProvider: SpritesProvider
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    @Published var borderColor: Color = .black
    @Published var text: String = ""
    @Published var image: Image? = nil
    @Published var isVisible: Bool = false
    @Published var position: Positioning = .leadingTop

    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.gameState()
            .map { $0.toasts }
            .filter { $0.is_valid }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.load(toast: $0) }
            .store(in: &disposables)
    }
    
    private func load(toast: CToast) {
        text = string(from: toast.text) ?? "..."
        position = toast.mode.rawValue == 0 ? .trailingTop : .leadingTop
        borderColor = toast.mode.rawValue == 0 ? .cyan : .highlightedText
        isVisible = true
        hide(delay: TimeInterval(toast.duration))
        
        let cgImage = spritesProvider.cgImage(for: toast.image.sprite_sheet_id, textureRect: toast.image.texture_frame)
        
        if let cgImage {
            image = Image(decorative: cgImage, scale: 1)
        } else {
            image = nil
        }
    }
    
    private func hide(delay: TimeInterval) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            withAnimation {
                self?.isVisible = false
            }
        }
    }
}
