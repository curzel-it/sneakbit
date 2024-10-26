import SwiftUI
import Schwifty

struct ContentView: View {
    var body: some View {
        ZStack {
            GameViewRepresentable()
            ControllerEmulatorView()
            ToastView()
        }
        .ignoresSafeArea()
        .typography(.text)
    }
}
