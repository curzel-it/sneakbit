import SwiftUI

@main
struct NokemonApp: App {
    init() {
        Dependencies.setup()
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
