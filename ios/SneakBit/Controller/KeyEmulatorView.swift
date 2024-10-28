import Foundation
import SwiftUI
import Schwifty

struct KeyEmulatorView: View {
    static let size = CGSize(width: 56, height: 56)
    static let iconSize = CGSize(width: 24, height: 24)
    
    let key: EmulatedKey
    
    @State private var isBeingPressed = false
    
    var body: some View {
        Image("\(key.imageName)_button_\(isBeingPressed ? "down" : "up")")
            .interpolation(.none)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: KeyEmulatorView.size.width, height: KeyEmulatorView.size.height)
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


/*
import Foundation
import SwiftUI
import Schwifty

struct KeyEmulatorView: View {
    static let size = CGSize(width: 48, height: 48)
    static let iconSize = CGSize(width: 24, height: 24)
        
    let key: EmulatedKey
    
    @State var isBeingPressed = false
    
    var body: some View {
        Image("\(key.systemImageName)_button_\(isBeingPressed ? "down" : "up")")
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(size: KeyEmulatorView.iconSize)
            .foregroundStyle(Color.black)
            .frame(size: KeyEmulatorView.size)
            .background(Color.gray.opacity(0.7))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .onTapGesture {
                @Inject var engine: GameEngine
                engine.setKeyDown(key)
            }
    }
}
*/
