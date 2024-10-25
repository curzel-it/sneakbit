import Foundation
import SwiftUI
import Schwifty

struct KeyEmulatorView: View {
    static let size = CGSize(width: 48, height: 48)
    static let iconSize = CGSize(width: 24, height: 24)
    
    @StateObject private var viewModel: KeyEmulatorViewModel
    
    init(key: EmulatedKey) {
        let vm = KeyEmulatorViewModel(key: key)
        _viewModel = StateObject(wrappedValue: vm)
    }
    
    var body: some View {
        Image(systemName: viewModel.imageName)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(size: KeyEmulatorView.iconSize)
            .foregroundStyle(Color.black)
            .frame(size: KeyEmulatorView.size)
            .background(Color.gray.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .onLongPressGesture(
                minimumDuration: 0,
                maximumDistance: .infinity,
                pressing: viewModel.onPressingChanged,
                perform: {})
    }
}

private class KeyEmulatorViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    let imageName: String
    private var isPressed = false
    private let key: EmulatedKey
    
    init(key: EmulatedKey) {
        self.key = key
        imageName = key.imageName
    }
    
    func onPressingChanged(_ pressing: Bool) {
        if pressing {
            if !isPressed {
                isPressed = true
                engine.setKeyDown(key)
            }
        } else {
            if isPressed {
                isPressed = false
                engine.setKeyUp(key)
            }
        }
    }
}
