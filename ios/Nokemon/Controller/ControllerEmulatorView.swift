import Foundation
import SwiftUI
import Schwifty

struct ControllerEmulatorView: View {
    var body: some View {
        ZStack {
            HStack {
                KeyEmulatorView(key: .attack)
                    .padding(.bottom, KeyEmulatorView.size.height / 2)
                KeyEmulatorView(key: .confirm)
            }
            .positioned(.leadingBottom)
            JoystickContainer()
        }
        .padding(.horizontal)
        .positioned(.bottom)
        .padding(.bottom, 30)
    }
}

private struct JoystickContainer: View {
    var body: some View {
        JoystickView()
            .frame(maxWidth: .infinity, maxHeight: .infinity) 
    }
}

