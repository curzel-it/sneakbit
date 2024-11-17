import Foundation
import SwiftUI
import Schwifty

struct KeyEmulatorView: View {
    static let size = CGSize(width: 60, height: 60)
    static let iconSize = CGSize(width: 24, height: 24)
    static let padding: CGFloat = 15
    
    let key: EmulatedKey
    
    @State private var isBeingPressed = false
    
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
                            @Inject var engine: GameEngine
                            engine.setKeyDown(key)
                        }
                    }
                    .onEnded { _ in
                        isBeingPressed = false
                        @Inject var engine: GameEngine
                        engine.setKeyUp(key)
                    }
            )
    }
}
