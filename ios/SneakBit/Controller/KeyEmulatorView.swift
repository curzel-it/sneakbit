import Foundation
import SwiftUI
import Schwifty

struct KeyEmulatorView: View {
    static let size = CGSize(width: 60, height: 60)
    static let iconSize = CGSize(width: 24, height: 24)
    static let padding: CGFloat = 15
    
    let key: EmulatedKey
    
    @State private var isBeingPressed = false
    
    private let onKeyDown: (EmulatedKey) -> Void
    
    init(key: EmulatedKey) {
        @Inject var engine: GameEngine
        self.init(key: key, onKeyDown: engine.setKeyDown)
    }
    
    init(key: EmulatedKey, onKeyDown: @escaping (EmulatedKey) -> Void) {
        self.key = key
        self.onKeyDown = onKeyDown
    }
    
    var body: some View {
        Image("\(key.imageName)_button_\(isBeingPressed ? "down" : "up")")
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
