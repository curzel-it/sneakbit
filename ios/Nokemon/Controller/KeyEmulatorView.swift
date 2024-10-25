import Foundation
import SwiftUI
import Schwifty

struct KeyEmulatorView: View {
    static let size = CGSize(width: 40, height: 40)
    static let iconSize: CGFloat = 24
    
    let key: EmulatedKey
    
    @State private var isPressed = false

    var body: some View {
        Image(systemName: key.imageName)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: KeyEmulatorView.iconSize)
            .frame(height: KeyEmulatorView.iconSize)
            .foregroundStyle(Color.black)
            .frame(size: KeyEmulatorView.size)
            .background(Color.gray.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .onLongPressGesture(minimumDuration: 0, maximumDistance: .infinity, pressing: { pressing in
                if pressing {
                    if !isPressed {
                        isPressed = true
                        GameEngine.shared.setKeyDown(key)
                    }
                } else {
                    if isPressed {
                        isPressed = false
                        GameEngine.shared.setKeyUp(key)
                    }
                }
            }, perform: {})
    }
}
