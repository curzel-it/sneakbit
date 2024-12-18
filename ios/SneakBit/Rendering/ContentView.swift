import SwiftUI
import Schwifty

struct ContentView: View {
    var body: some View {
        ZStack {
            GameViewRepresentable()
            HpView()
            ControllerEmulatorView()
            MenuView()
            OptionsView()
            LoadingScreen()
            DeathScreen()
            ToastView()
            LaunchScreenView()
        }
        .ignoresSafeArea()
        .typography(.text)
    }
}
