import Firebase
import SwiftUI

@main
struct SneakBitApp: App {
    init() {
        FirebaseApp.configure()
        Dependencies.setup()
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .statusBarHidden(true)
                .foregroundStyle(Color.white)
        }
    }
}
