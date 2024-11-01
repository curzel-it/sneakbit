import SwiftUI

@main
struct SneakBitApp: App {
    init() {
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
