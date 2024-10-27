import Foundation
import SwiftUI
import Schwifty

struct KeyEmulatorView: View {
    static let size = CGSize(width: 48, height: 48)
    static let iconSize = CGSize(width: 24, height: 24)
        
    let key: EmulatedKey
    
    var body: some View {
        Image(systemName: key.imageName)
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
