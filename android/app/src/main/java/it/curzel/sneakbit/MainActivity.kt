package it.curzel.sneakbit

import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.ByteArrayInputStream
import java.io.IOException

// The Android app is a thin native shell: a full-screen WebView that runs the
// exact same HTML/JS game that ships to the web and to Steam (Electron). No game
// logic lives in Kotlin — it's the same js/ + assets/ + data/ build, bundled
// into the APK (src/main/assets/web/) so it plays fully offline on first launch.
//
// The bundle is served over https://appassets.androidplatform.net via
// shouldInterceptRequest below — the Android mirror of the iOS app:// scheme:
//   * A real https origin gives the page a secure context (WebRTC data channels,
//     crypto) and lets its relative fetch()es for ./data/*.json and ./assets/*
//     resolve, which file:// would block.
//   * appassets.androidplatform.net is a reserved, non-routable host, so the
//     game's own host resolution (js/net.js, js/apiBase.js) treats it as "not
//     localhost" and points opt-in online co-op at production — and real
//     traffic to sneakbit.curzel.it (a different host) is never intercepted, so
//     it goes out to the network normally.
private const val ASSET_HOST = "appassets.androidplatform.net"
private const val ENTRY_URL = "https://appassets.androidplatform.net/play/index.html"

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Draw edge-to-edge (under the cutout) and hide the system bars — it's a
        // game. The web overlays keep clear of the notch via env(safe-area-inset)
        // because the window is allowed to render into the display cutout.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            configureSettings(settings)
            webViewClient = BundleWebViewClient()
            loadUrl(ENTRY_URL)
        }
        setContentView(webView)

        // Back navigates the page if it can; otherwise background the app so the
        // running game (and its in-memory state) survives instead of being torn
        // down. Saves also persist to localStorage regardless.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
            }
        })
    }

    private fun configureSettings(s: WebSettings) {
        s.javaScriptEnabled = true
        // localStorage holds the game's saves — must survive across launches.
        s.domStorageEnabled = true
        // Autoplay music/SFX without a user gesture — the game manages its own
        // audio lifecycle.
        s.mediaPlaybackRequiresUserGesture = false
        // The page sets its own viewport (js/zoom.js); don't let WebView override.
        s.useWideViewPort = true
        s.loadWithOverviewMode = false
        @Suppress("DEPRECATION")
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.cacheMode = WebSettings.LOAD_DEFAULT
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        // Detach before destroy to avoid leaking the activity through the WebView.
        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }
}

/**
 * Serves the bundled web build (src/main/assets/web/) for requests to
 * https://appassets.androidplatform.net/…, with the right MIME type and HTTP
 * Range support (the game plays audio via HTMLAudioElement, which seeks with
 * byte-range requests). Any other host falls through to the network so opt-in
 * online co-op (wss/https to sneakbit.curzel.it) works.
 */
private class BundleWebViewClient : WebViewClient() {

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest
    ): WebResourceResponse? {
        val url = request.url
        if (!url.host.equals(ASSET_HOST, ignoreCase = true)) return null

        var path = url.path ?: "/"
        if (path == "/" || path.isEmpty()) path = "/play/index.html"
        // Path-traversal guard: reject anything that tries to climb out of web/.
        if (path.contains("..")) return notFound()

        val assetPath = "web$path"
        val mime = mimeFor(path)
        val assets = view.context.assets

        return try {
            val rangeHeader = request.requestHeaders["Range"]
            if (rangeHeader != null) {
                val bytes = assets.open(assetPath).use { it.readBytes() }
                val range = parseRange(rangeHeader, bytes.size)
                if (range != null) {
                    val (start, endIncl) = range
                    val slice = bytes.copyOfRange(start, endIncl + 1)
                    val headers = linkedMapOf(
                        "Accept-Ranges" to "bytes",
                        "Content-Range" to "bytes $start-$endIncl/${bytes.size}",
                        "Content-Length" to slice.size.toString(),
                        "Access-Control-Allow-Origin" to "*",
                    )
                    WebResourceResponse(
                        mime, encodingFor(mime), 206, "Partial Content",
                        headers, ByteArrayInputStream(slice)
                    )
                } else {
                    fullResponse(mime, assets.open(assetPath))
                }
            } else {
                fullResponse(mime, assets.open(assetPath))
            }
        } catch (e: IOException) {
            notFound()
        }
    }

    private fun fullResponse(mime: String, stream: java.io.InputStream): WebResourceResponse {
        val headers = linkedMapOf(
            "Accept-Ranges" to "bytes",
            "Access-Control-Allow-Origin" to "*",
        )
        return WebResourceResponse(mime, encodingFor(mime), 200, "OK", headers, stream)
    }

    private fun notFound(): WebResourceResponse =
        WebResourceResponse(
            "text/plain", "utf-8", 404, "Not Found",
            emptyMap(), ByteArrayInputStream(ByteArray(0))
        )
}

/** ES modules and JSON must carry a JS/JSON content type or WebView won't
 *  execute/parse them; the rest keep asset loads sane. */
private fun mimeFor(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
    "html", "htm" -> "text/html"
    "js", "mjs" -> "text/javascript"
    "json", "map" -> "application/json"
    "css" -> "text/css"
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "gif" -> "image/gif"
    "webp" -> "image/webp"
    "svg" -> "image/svg+xml"
    "ico" -> "image/x-icon"
    "wav" -> "audio/wav"
    "mp3" -> "audio/mpeg"
    "ogg" -> "audio/ogg"
    "m4a" -> "audio/mp4"
    "woff" -> "font/woff"
    "woff2" -> "font/woff2"
    "ttf" -> "font/ttf"
    "txt" -> "text/plain"
    else -> "application/octet-stream"
}

private fun encodingFor(mime: String): String? =
    if (mime.startsWith("text/") || mime == "application/json" || mime == "image/svg+xml") "utf-8" else null

/**
 * Parse a single-range `bytes=start-end` header (the only form WebView sends
 * for media) into an inclusive (start, end) pair, or null for unsupported /
 * whole-file requests.
 */
private fun parseRange(header: String, total: Int): Pair<Int, Int>? {
    if (total <= 0) return null
    val spec = header.substringAfter("bytes=", "").trim()
    if (spec.isEmpty() || spec.contains(",")) return null
    val dash = spec.indexOf('-')
    if (dash < 0) return null
    val startStr = spec.substring(0, dash)
    val endStr = spec.substring(dash + 1)

    val start: Int
    val end: Int
    if (startStr.isEmpty()) {
        // Suffix range "-N": last N bytes.
        val n = endStr.toIntOrNull() ?: return null
        if (n <= 0) return null
        start = maxOf(0, total - n)
        end = total - 1
    } else {
        start = startStr.toIntOrNull() ?: return null
        end = if (endStr.isEmpty()) total - 1 else (endStr.toIntOrNull() ?: (total - 1))
    }
    if (start < 0 || start >= total) return null
    val clampedEnd = minOf(end, total - 1)
    if (clampedEnd < start) return null
    return start to clampedEnd
}
