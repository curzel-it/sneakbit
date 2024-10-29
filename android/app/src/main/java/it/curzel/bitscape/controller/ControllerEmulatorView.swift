import Foundation
import SwiftUI
import Schwifty

struct ControllerEmulatorView: View {
    @StateObject private var viewModel = ControllerEmulatorViewModel()
    
    var body: some View {
        ZStack {
            JoystickView()
            
            HStack(spacing: KeyEmulatorView.size.height / 3) {
                KeyEmulatorView(key: .attack).padding(.bottom, KeyEmulatorView.size.height)
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
        .padding(.bottom, 80)
    }
}

private class ControllerEmulatorViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
}
