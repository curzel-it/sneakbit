import SwiftUI
import Schwifty

struct ContentView: View {
    var body: some View {
        ZStack {
            GameViewRepresentable()
            ControllerEmulatorView().positioned(.bottom)
        }
    }
}
