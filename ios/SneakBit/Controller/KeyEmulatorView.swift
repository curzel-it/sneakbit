import Foundation
import SwiftUI
import Schwifty

struct KeyEmulatorView: View {
    static let size = CGSize(width: 60, height: 60)
    static let iconSize = CGSize(width: 24, height: 24)
    static let padding: CGFloat = 15
    
    let key: EmulatedKey
    let image: String?
    
    @State private var isBeingPressed = false
    
    private let onKeyDown: (EmulatedKey) -> Void
    
    init(key: EmulatedKey, image: String? = nil) {
        @Inject var engine: GameEngine
        self.init(key: key, image: image, onKeyDown: engine.setKeyDown)
    }
    
    init(key: EmulatedKey, image: String? = nil, onKeyDown: @escaping (EmulatedKey) -> Void) {
        self.key = key
        self.image = image
        self.onKeyDown = onKeyDown
    }
    
    var body: some View {
        Image("\(image ?? key.imageName)_button_\(isBeingPressed ? "down" : "up")")
            .interpolation(.none)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: KeyEmulatorView.size.width, height: KeyEmulatorView.size.height)
            .padding(KeyEmulatorView.padding)
            .contentShape(Rectangle())
            .onTapGesture {
                onKeyDown(key)
            }
    }
}
