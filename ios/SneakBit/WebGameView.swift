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

/// Name js/haptics.js posts to: `window.webkit.messageHandlers.haptics`.
/// Its presence is also what tells the web build it's running inside this
/// shell and should prefer the bridge over navigator.vibrate.
let kHapticsHandler = "haptics"

/// Turns a haptic request from the web build into taptic-engine feedback.
///
/// The message body is the kind js/haptics.js sends — "tap" for a d-pad step
/// or the menu button, "action" for melee/throw/interact. Durations don't
/// cross the bridge: they're a Vibration-API concept and mean nothing here,
/// so the style is chosen on this side.
///
/// WKScriptMessageHandler callbacks arrive on the main thread, which is where
/// UIFeedbackGenerator must be used.
final class HapticsHandler: NSObject, WKScriptMessageHandler {
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let medium = UIImpactFeedbackGenerator(style: .medium)

    override init() {
        super.init()
        // Warm the engine so the very first tap of a session isn't late.
        light.prepare()
        medium.prepare()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        let generator = (message.body as? String) == "action" ? medium : light
        generator.impactOccurred()
        // Taps come in bursts (a thumb on the d-pad); keep it warm for the next.
        generator.prepare()
    }
}

struct WebGameView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Serve the bundled web/ tree over app:// (offline, real host).
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: kAppScheme)

        // Haptics for the on-screen touch controls. WebKit ships neither the
        // Vibration API nor gamepad rumble, so js/haptics.js posts here instead
        // and we drive the taptic engine — impact feedback rather than a buzz,
        // which is the better control on this hardware anyway.
        config.userContentController.add(HapticsHandler(), name: kHapticsHandler)

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
