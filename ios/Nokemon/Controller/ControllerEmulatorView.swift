import Foundation
import SwiftUI
import Schwifty

struct ControllerEmulatorView: View {
    var body: some View {
        ZStack {
            JoystickView()
            
            HStack {
                KeyEmulatorView(key: .attack)
                    .padding(.bottom, KeyEmulatorView.size.height / 2)
                KeyEmulatorView(key: .confirm)
            }
            .positioned(.leadingBottom)
        }
        .padding(.horizontal)
        .positioned(.bottom)
        .padding(.bottom, 30)
    }
}
