import Foundation
import SwiftUI
import Schwifty

struct KeyEmulatorView: View {
    static let size = CGSize(width: 60, height: 60)
    static let iconSize = CGSize(width: 24, height: 24)
    static let padding: CGFloat = 15
    
    let key: EmulatedKey
    
    @State private var isBeingPressed = false
    
    private let setKeyUp: (EmulatedKey) -> Void
    private let setKeyDown: (EmulatedKey) -> Void
    
    init(key: EmulatedKey) {
        @Inject var engine: GameEngine
        self.init(key: key, setKeyUp: engine.setKeyUp, setKeyDown: engine.setKeyDown)
    }
    
    init(
        key: EmulatedKey,
        setKeyUp: @escaping (EmulatedKey) -> Void,
        setKeyDown: @escaping (EmulatedKey) -> Void
    ) {
        self.key = key
        self.setKeyUp = setKeyUp
        self.setKeyDown = setKeyDown
    }
    
    var body: some View {
        Image("\(key.imageName)_button_\(isBeingPressed ? "down" : "up")")
            .interpolation(.none)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: KeyEmulatorView.size.width, height: KeyEmulatorView.size.height)
            .padding(KeyEmulatorView.padding)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        if !isBeingPressed {
                            isBeingPressed = true
                            setKeyDown(key)
                        }
                    }
                    .onEnded { _ in
                        isBeingPressed = false
                        setKeyUp(key)
                    }
            )
    }
}
