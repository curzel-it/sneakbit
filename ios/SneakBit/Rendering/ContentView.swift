import SwiftUI
import Schwifty

struct ContentView: View {
    var body: some View {
        ZStack {
            GameViewRepresentable()
            HpView()
            ControllerEmulatorView()
            MessagesView()
            FastTravelMenu()
            PvpArenaMenu()
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
