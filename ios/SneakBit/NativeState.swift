//
//  NativeState.swift
//  SneakBit
//
//  The iOS half of the native save bridge (see js/nativeBridge.js) — the
//  counterpart of electron/nativeState.js and android/…/NativeState.kt.
//
//  Two files in the app container matter:
//
//    Documents/save.json           the save left by the Rust build this one
//                                  replaces. This ships as an update to the
//                                  same bundle id (it.curzel.bitscape), so the
//                                  container — and that file — survive the
//                                  update. The web build imports it once.
//
//    Documents/sneakbit-save.json  this build's own save, mirrored out of
//                                  localStorage. WebKit's storage is opaque and
//                                  has no recovery story; the old game wrote a
//                                  plain file, and players carry saves that
//                                  exist nowhere else, so we keep one too.
//
//  The old build also kept its sound toggles in UserDefaults rather than in
//  save.json (that's the mobile/desktop split the `desktop_only.` key prefix
//  refers to), so they're read here and handed over alongside.
//

import Foundation

enum NativeState {

    private static let legacySaveName = "save.json"
    private static let mirrorName = "sneakbit-save.json"

    /// The renderer only ever sends a saveBlob envelope. Anything near this
    /// size is a bug, not a save.
    private static let maxMirrorBytes = 256 * 1024

    /// UserDefaults keys from the old build's AudioEngine, verbatim.
    private static let kSoundEffectsEnabled = "kSoundEffectsEnabled"
    private static let kMusicEnabled = "kMusicEnabled"

    private static var documentsURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    private static var legacySaveURL: URL { documentsURL.appendingPathComponent(legacySaveName) }
    private static var mirrorURL: URL { documentsURL.appendingPathComponent(mirrorName) }

    // MARK: - Reading

    /// The envelope js/nativeBridge.js expects, ready to serve. Never throws:
    /// an unreadable file is indistinguishable from an absent one as far as the
    /// game is concerned, and the fallback still says "you're in a native
    /// shell", which is what gates the mirror writes.
    static func envelopeData() -> Data {
        var envelope: [String: Any] = [
            "platform": "ios",
            "mirror": readJSONObject(at: mirrorURL) ?? NSNull(),
            "legacy": NSNull(),
        ]
        // `legacy` only means something with a save in it — the audio prefs are
        // carried across as part of an import, never on their own.
        if let save = readJSONObject(at: legacySaveURL) {
            let audio: Any = legacyAudio() ?? NSNull()
            envelope["legacy"] = ["save": save, "audio": audio]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: envelope) else {
            return Data(#"{"platform":"ios","mirror":null,"legacy":null}"#.utf8)
        }
        return data
    }

    private static func readJSONObject(at url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return parsed
    }

    /// The old sound/music toggles, or nil if the player never had them stored
    /// (a fresh install of the old build wrote both on first launch, so nil
    /// really does mean "never ran it"). A key that's missing while the other
    /// is present defaults to enabled — that was the old build's default.
    private static func legacyAudio() -> [String: Any]? {
        let defaults = UserDefaults.standard
        let sfx = defaults.object(forKey: kSoundEffectsEnabled) as? Bool
        let music = defaults.object(forKey: kMusicEnabled) as? Bool
        if sfx == nil && music == nil { return nil }
        return ["sfx": sfx ?? true, "music": music ?? true]
    }

    // MARK: - Writing

    /// Persist the renderer's save mirror. `.atomic` writes to a temp file and
    /// renames, so a kill mid-write can't leave a truncated save — the exact
    /// failure the old Rust build's truncate-then-write was exposed to.
    static func writeMirror(_ text: String) {
        let data = Data(text.utf8)
        guard data.count <= maxMirrorBytes,
              (try? JSONSerialization.jsonObject(with: data)) != nil
        else { return }
        do {
            try data.write(to: mirrorURL, options: .atomic)
        } catch {
            // A failed backup write must never disturb play; localStorage still
            // holds the save.
            NSLog("[NativeState] mirror write failed: \(error)")
        }
    }
}
