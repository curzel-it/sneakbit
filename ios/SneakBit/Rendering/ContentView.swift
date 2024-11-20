import SwiftUI
import Schwifty

struct ContentView: View {
    var body: some View {
        ZStack {
            GameViewRepresentable()
            ControllerEmulatorView()
            ToastView()
            MenuView()
            OptionsView()
            LoadingScreen()
            DeathScreen()
        }
        .ignoresSafeArea()
        .typography(.text)
    }
}
