import SwiftUI
import Schwifty

struct ContentView: View {
    var body: some View {
        ZStack {
            GameViewRepresentable()
            ControllerEmulatorView()
            MenuView()
            OptionsView()
            LoadingScreen()
            DeathScreen()
            ToastView()
        }
        .ignoresSafeArea()
        .typography(.text)
    }
}
