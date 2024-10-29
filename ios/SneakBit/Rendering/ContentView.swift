import SwiftUI
import Schwifty

struct ContentView: View {
    var body: some View {
        ZStack {
            GameViewRepresentable()
            ControllerEmulatorView()
            InventoryView()
            ToastView()
            MenuView()
            LoadingScreen()
            DeathScreen()
        }
        .ignoresSafeArea()
        .typography(.text)
    }
}

/*
 
 
 (AnchorPoint::BottomCenter, self.menu.ui(&self.camera_viewport)),
 (AnchorPoint::BottomCenter, self.entity_options_menu.ui()),
 (AnchorPoint::BottomCenter, self.dialogue_menu.ui()),
 (AnchorPoint::BottomCenter, self.confirmation_dialog.ui()),
 (AnchorPoint::BottomCenter, self.long_text_display.ui()),
 
 **/
