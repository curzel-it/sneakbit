import Firebase
import SwiftUI

@main
struct SneakBitApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Inject private var broker: RuntimeEventsBroker
    
    init() {
        FirebaseApp.configure()
        Dependencies.setup()
        broker.send(.launched)
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .statusBarHidden(true)
                .foregroundStyle(Color.white)
        }
    }
}

private class AppDelegate: NSObject, UIApplicationDelegate {
    @Inject private var broker: RuntimeEventsBroker
    
    func applicationDidEnterBackground(_ application: UIApplication) {
        broker.send(.didEnterBackground)
    }
    
    func applicationWillEnterForeground(_ application: UIApplication) {
        broker.send(.willEnterForeground)
    }
}
