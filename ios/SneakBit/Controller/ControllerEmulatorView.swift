import Foundation
import SwiftUI
import Schwifty

struct ControllerEmulatorView: View {
    @StateObject private var viewModel = ControllerEmulatorViewModel()
    
    var body: some View {
        GeometryReader { geo in
            let isLandscape = geo.size.width >= geo.size.height
            
            HStack(spacing: .zero) {
                HStack(spacing: .zero) {
                    KeyEmulatorView(key: .attack).padding(.bottom, 30)
                    KeyEmulatorView(key: .confirm)
                }
                .positioned(.leadingBottom)
                .padding(.leading, isLandscape ? 85 : 20)
                .padding(.trailing, viewModel.safeAreaInsets.right)
                .padding(.leading, viewModel.safeAreaInsets.left)
                .padding(.bottom, isLandscape ? 120 : 140)
                
                JoystickView()
                    .padding(.leading, -100)
            }
            .padding(.top, viewModel.safeAreaInsets.top)
            .padding(.bottom, viewModel.safeAreaInsets.bottom)
        }
    }
}

private class ControllerEmulatorViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    var isLandscape: Bool {
        engine.isLandscape
    }
}
