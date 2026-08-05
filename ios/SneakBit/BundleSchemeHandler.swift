//
//  BundleSchemeHandler.swift
//  SneakBit
//
//  Serves the bundled web build (the `web/` folder reference) over a custom
//  `app://` scheme — the iOS mirror of the Electron desktop wrapper's
//  electron/appProtocol.js. The game is a pure web app (js/ + assets/ + data/);
//  this handler is what makes it run offline from inside the .app.
//
//  Why a custom scheme instead of file://:
//    * Under file:// WebKit blocks the relative fetch()es the game makes for
//      ./data/*.json and the <img>/<audio> loads of ./assets/* (cross-origin /
//      opaque-origin restrictions). A registered scheme serves them cleanly.
//    * It gives the page a real host. We serve from `sneakbit.curzel.it` so the
//      game's own host resolution (js/net.js, js/apiBase.js) points opt-in
//      online co-op at production — with zero changes to game code, exactly
//      like the desktop build.
//
//  Range requests: the game plays audio via HTMLAudioElement (js/audio.js,
//  js/music.js). WebKit fetches media with byte-range requests and will refuse
//  to play if the handler ignores `Range`, so we honour it with 206 responses.
//

import Foundation
import WebKit

/// Host baked into the document URL. Kept identical to the desktop wrapper so
/// the game's `location.hostname`-based production/localhost switch behaves the
/// same in every shipped build.
let kAppScheme = "app"
let kAppHost = "sneakbit.curzel.it"
let kAppEntryURL = "app://sneakbit.curzel.it/index.html"

final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    // Root of the bundled web tree (the `web/` folder reference). Resolved once.
    private let webRoot: URL
    // File reads run off the main thread; a task may be stopped by WebKit
    // mid-read (navigation away), so we track live tasks and never message a
    // stopped one. Guarded by `lock` since start/stop arrive on the main thread
    // while reads finish on `ioQueue`.
    private let ioQueue = DispatchQueue(label: "it.curzel.SneakBit.scheme", qos: .userInitiated, attributes: .concurrent)
    private let lock = NSLock()
    private var liveTasks = Set<ObjectIdentifier>()

    override init() {
        // The folder reference lands in the app bundle as `web/…`. Falling back
        // to resourceURL keeps this working if the folder is ever flattened.
        let bundle = Bundle.main
        if let url = bundle.url(forResource: "web", withExtension: nil) {
            webRoot = url
        } else {
            webRoot = bundle.resourceURL ?? bundle.bundleURL
        }
        super.init()
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let id = ObjectIdentifier(task)
        lock.lock(); liveTasks.insert(id); lock.unlock()

        guard let url = task.request.url else {
            finishWithError(task, id, code: NSURLErrorBadURL)
            return
        }

        // Map the request path onto the bundled tree. "/" → the game shell.
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let relative = String(path.drop(while: { $0 == "/" }))

        let rangeHeader = task.request.value(forHTTPHeaderField: "Range")

        ioQueue.async { [weak self] in
            guard let self else { return }

            // Resolve and confine to webRoot (path-traversal guard).
            let fileURL = self.webRoot.appendingPathComponent(relative).standardizedFileURL
            let rootPath = self.webRoot.standardizedFileURL.path
            guard fileURL.path == rootPath || fileURL.path.hasPrefix(rootPath + "/") else {
                self.finishWithError(task, id, code: NSURLErrorNoPermissionsToReadFile)
                return
            }

            guard let data = try? Data(contentsOf: fileURL, options: .mappedIfSafe) else {
                self.finishWithError(task, id, code: NSURLErrorFileDoesNotExist)
                return
            }

            let mime = Self.mimeType(for: fileURL.pathExtension)
            if let rangeHeader, let range = Self.parseRange(rangeHeader, total: data.count) {
                self.respond(task, id, url: url, mime: mime, data: data.subdata(in: range), full: data.count, range: range)
            } else {
                self.respond(task, id, url: url, mime: mime, data: data, full: data.count, range: nil)
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock(); liveTasks.remove(ObjectIdentifier(task)); lock.unlock()
    }

    // MARK: - Responding

    private func isLive(_ id: ObjectIdentifier) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return liveTasks.contains(id)
    }

    private func retire(_ id: ObjectIdentifier) {
        lock.lock(); liveTasks.remove(id); lock.unlock()
    }

    private func respond(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, url: URL, mime: String, data: Data, full: Int, range: Range<Int>?) {
        guard isLive(id) else { return }

        var headers = [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        ]
        var status = 200
        if let range {
            status = 206
            headers["Content-Range"] = "bytes \(range.lowerBound)-\(range.upperBound - 1)/\(full)"
        }

        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        // WKURLSchemeTask requires its callbacks be serialized and never sent
        // after stop(); guard each one.
        guard isLive(id) else { return }
        task.didReceive(response)
        guard isLive(id) else { return }
        task.didReceive(data)
        guard isLive(id) else { return }
        task.didFinish()
        retire(id)
    }

    private func finishWithError(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, code: Int) {
        guard isLive(id) else { return }
        task.didFailWithError(NSError(domain: NSURLErrorDomain, code: code))
        retire(id)
    }

    // MARK: - Helpers

    /// Parse a single-range `bytes=start-end` header (the only form WebKit
    /// sends for media). Returns a half-open Range into the data, or nil for
    /// unsupported/whole-file requests.
    static func parseRange(_ header: String, total: Int) -> Range<Int>? {
        guard total > 0 else { return nil }
        guard let eq = header.range(of: "bytes=") else { return nil }
        let spec = header[eq.upperBound...]
        // Multi-range ("a-b,c-d") isn't needed by HTMLMediaElement; bail to 200.
        if spec.contains(",") { return nil }
        let parts = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let startStr = parts.first.map(String.init) ?? ""
        let endStr = parts.count > 1 ? String(parts[1]) : ""

        var start: Int
        var end: Int
        if startStr.isEmpty {
            // Suffix range "-N": last N bytes.
            guard let n = Int(endStr), n > 0 else { return nil }
            start = max(0, total - n)
            end = total - 1
        } else {
            guard let s = Int(startStr) else { return nil }
            start = s
            end = endStr.isEmpty ? total - 1 : (Int(endStr) ?? total - 1)
        }
        guard start >= 0, start < total else { return nil }
        end = min(end, total - 1)
        guard end >= start else { return nil }
        return start..<(end + 1)
    }

    /// Extension → MIME. ES modules and JSON must carry the right type or WebKit
    /// refuses to execute/parse them; the rest keep asset loads sane.
    static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "wav": return "audio/wav"
        case "mp3": return "audio/mpeg"
        case "ogg": return "audio/ogg"
        case "m4a": return "audio/mp4"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
