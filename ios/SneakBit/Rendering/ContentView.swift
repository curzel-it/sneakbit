import SwiftUI
import Schwifty

struct ContentView: View {
    var body: some View {
        ZStack {
            GameViewRepresentable()
            HpView()
            ControllerEmulatorView()
            MessagesView()
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
