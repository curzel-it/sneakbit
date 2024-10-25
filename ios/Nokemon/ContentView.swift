import SwiftUI
import Schwifty

struct ContentView: View {
    var body: some View {
        ZStack {
            GameViewRepresentable()
                .ignoresSafeArea()
            
            ControllerEmulatorView()
                .positioned(.bottom)
                .padding(.bottom, 30)
        }
    }
}
