import Foundation
import SwiftUI
import Schwifty

struct ControllerEmulatorView: View {
    var body: some View {
        HStack {
            KeyEmulatorView(key: .attack)
                .padding(.bottom, KeyEmulatorView.size.height / 2)
            KeyEmulatorView(key: .confirm)
            Spacer()
            JoystickView()
        }
        .padding(.horizontal)
    }
}
