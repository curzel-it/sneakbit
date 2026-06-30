//
//  SneakBitApp.swift
//  SneakBit
//
//  Created by Federico Curzel on 29/06/26.
//

import SwiftUI

@main
struct SneakBitApp: App {
    init() {
        // Without this the WKWebView's game audio is muted by the silent switch.
        AudioSession.activate()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
