//
//  ContentView.swift
//  SneakBit
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        WebGameView()
            // Edge-to-edge: the web layer sizes itself to the viewport
            // (js/zoom.js) and draws its own HUD inside the safe area via CSS
            // env(safe-area-inset-*), so let it own the full screen.
            .ignoresSafeArea(.all)
            .background(.black)
            // It's a game: hide the status bar and the home-indicator overlay.
            .statusBarHidden(true)
            .persistentSystemOverlays(.hidden)
    }
}

#Preview {
    ContentView()
}
