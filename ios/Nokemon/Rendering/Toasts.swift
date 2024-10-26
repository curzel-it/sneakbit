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
            .background(viewModel.backgroundColor)
            .opacity(viewModel.opacity)
            .positioned(viewModel.position)
            .padding()
        }
    }
}

private class ToastViewModel: ObservableObject {
    @Inject private var gameEngine: GameEngine
    @Inject private var spritesProvider: SpritesProvider
    
    @Published var backgroundColor: Color = .black
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
        Task { @MainActor in
            let toast = ToastState(
                background_color: NonColorC(red: 255, green: 0, blue: 0, alpha: 128),
                text: "Hellooo",
                mode: 1,
                image: ToastImage(
                    sprite_frame: IntRect(x: 0, y: 0, width: 0, height: 0),
                    sprite_sheet_id: 0,
                    number_of_frames: 0
                )
            )
            load(toast: toast)
        }
    }
    
    private func load(toast: ToastState) {
        backgroundColor = toast.background_color.asSolidColor()
        opacity = toast.background_color.opacity()
        text = toast.text
        isVisible = opacity > 0.05
        position = toast.mode == 0 ? .trailingTop : .leadingTop
        // image = spritesProvider.cgImage(for: toast.image.sprite_sheet_id, textureRect: toast.image.sprite_frame)
    }
}
