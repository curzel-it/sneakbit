//
//  WebGameView.swift
//  SneakBit
//
//  Full-screen WKWebView that runs the bundled web game. Thin wrapper — all
//  game logic lives in the web build; this only configures WebKit for a
//  game-like, offline, edge-to-edge experience and points it at the bundled
//  shell served by BundleSchemeHandler.
//

import SwiftUI
import WebKit

struct WebGameView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Serve the bundled web/ tree over app:// (offline, real host).
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: kAppScheme)

        // Games autoplay music/SFX and render the canvas inline — never use the
        // native fullscreen media UI or require a tap before audio.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.suppressesIncrementalRendering = false

        // No data persistence story beyond the game's own localStorage saves,
        // which the default persistent store already provides.

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black

        // The game owns the whole surface: kill scroll, bounce, zoom and inset
        // so touch input reaches the canvas/overlays unmolested.
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.minimumZoomScale = 1
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false

        // Surface the page console in Xcode during development.
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        if let url = URL(string: kAppEntryURL) {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        // The game never legitimately navigates away from the bundled origin.
        // Keep it inside app:// (and let WebSocket/fetch to the relay through —
        // those aren't navigations); open any real http(s) link externally.
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel); return
            }
            if url.scheme == kAppScheme {
                decisionHandler(.allow)
            } else if url.scheme == "http" || url.scheme == "https" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.cancel)
            }
        }
    }
}
