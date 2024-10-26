import Foundation
import SwiftUI
import Schwifty

struct ControllerEmulatorView: View {
    @StateObject private var viewModel = ControllerEmulatorViewModel()
    
    var body: some View {
        ZStack {
            JoystickView()
            
            HStack {
                KeyEmulatorView(key: .attack).padding(.bottom, KeyEmulatorView.size.height)
                KeyEmulatorView(key: .menu).padding(.bottom, KeyEmulatorView.size.height / 2)
                KeyEmulatorView(key: .confirm)
            }
            .positioned(.leadingBottom)
        }
        .padding(.horizontal)
        .positioned(.bottom)
        .padding(.top, viewModel.safeAreaInsets.top)
        .padding(.trailing, viewModel.safeAreaInsets.right)
        .padding(.bottom, viewModel.safeAreaInsets.bottom)
        .padding(.leading, viewModel.safeAreaInsets.left)
        .padding(.bottom, 30)
    }
}

private class ControllerEmulatorViewModel: ObservableObject {
    @Inject private var gameEngine: GameEngine
    
    var safeAreaInsets: UIEdgeInsets {
        gameEngine.safeAreaInsets
    }
    
}
