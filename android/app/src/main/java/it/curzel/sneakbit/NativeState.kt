package it.curzel.sneakbit

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * The Android half of the native save bridge (see js/nativeBridge.js) — the
 * counterpart of electron/nativeState.js and ios/SneakBit/NativeState.swift.
 *
 * Two files in internal storage matter:
 *
 *   filesDir/save.json           the save left by the Rust build this one
 *                                replaces. This ships as an update to the same
 *                                applicationId (it.curzel.bitscape), so that
 *                                directory survives the update and the web
 *                                build can import it once. Never deleted — it's
 *                                the player's only copy of a save that predates
 *                                accounts and cloud sync.
 *
 *   filesDir/sneakbit-save.json  this build's own save, mirrored out of
 *                                localStorage. WebView's storage is opaque and
 *                                has no recovery story; the old game wrote a
 *                                plain file, so we keep one too.
 *
 * The old build kept its sound toggles in SharedPreferences rather than in
 * save.json (that's the mobile/desktop split the `desktop_only.` key prefix
 * refers to), so they're read here and handed over alongside.
 */
object NativeState {

    private const val TAG = "NativeState"
    private const val LEGACY_SAVE = "save.json"
    private const val MIRROR = "sneakbit-save.json"

    /** The web build only ever sends a saveBlob envelope; anything near this
     *  size is a bug, not a save. */
    private const val MAX_MIRROR_BYTES = 256 * 1024

    /** SharedPreferences file and keys from the old build's AudioEngine. */
    private const val LEGACY_AUDIO_PREFS = "AudioSettings"
    private const val KEY_SFX_ENABLED = "kSoundEffectsEnabled"
    private const val KEY_MUSIC_ENABLED = "kMusicEnabled"

    /**
     * The envelope js/nativeBridge.js expects. Never throws: an unreadable file
     * is indistinguishable from an absent one as far as the game is concerned,
     * and the fallback still says "you're in a native shell", which is what
     * gates the mirror writes.
     */
    fun envelopeJson(context: Context): String {
        val envelope = JSONObject()
        envelope.put("platform", "android")
        envelope.put("mirror", readJsonObject(File(context.filesDir, MIRROR)) ?: JSONObject.NULL)

        // `legacy` only means something with a save in it — the audio prefs are
        // carried across as part of an import, never on their own.
        val legacySave = readJsonObject(File(context.filesDir, LEGACY_SAVE))
        if (legacySave != null) {
            val legacy = JSONObject()
            legacy.put("save", legacySave)
            legacy.put("audio", legacyAudio(context) ?: JSONObject.NULL)
            envelope.put("legacy", legacy)
        } else {
            envelope.put("legacy", JSONObject.NULL)
        }
        return envelope.toString()
    }

    private fun readJsonObject(file: File): JSONObject? = try {
        if (file.isFile && file.length() > 0) JSONObject(file.readText()) else null
    } catch (e: Exception) {
        Log.w(TAG, "unreadable ${file.name}: ${e.message}")
        null
    }

    /**
     * The old sound/music toggles, or null if the player never had them stored.
     * A key missing while the other is present defaults to enabled — that was
     * the old build's default.
     */
    private fun legacyAudio(context: Context): JSONObject? {
        val prefs = context.getSharedPreferences(LEGACY_AUDIO_PREFS, Context.MODE_PRIVATE)
        val hasSfx = prefs.contains(KEY_SFX_ENABLED)
        val hasMusic = prefs.contains(KEY_MUSIC_ENABLED)
        if (!hasSfx && !hasMusic) return null
        return JSONObject()
            .put("sfx", prefs.getBoolean(KEY_SFX_ENABLED, true))
            .put("music", prefs.getBoolean(KEY_MUSIC_ENABLED, true))
    }

    /**
     * Persist the web build's save mirror. Writes a temp file and renames, so a
     * kill mid-write can't leave a truncated save — the exact failure the old
     * Rust build's truncate-then-write was exposed to.
     */
    fun writeMirror(context: Context, text: String) {
        if (text.length > MAX_MIRROR_BYTES) return
        try {
            JSONObject(text)
        } catch (e: Exception) {
            Log.w(TAG, "refusing non-JSON mirror payload")
            return
        }
        val target = File(context.filesDir, MIRROR)
        val tmp = File(context.filesDir, "$MIRROR.tmp")
        try {
            tmp.writeText(text)
            if (!tmp.renameTo(target)) throw java.io.IOException("rename failed")
        } catch (e: Exception) {
            // A failed backup write must never disturb play; localStorage still
            // holds the save.
            Log.e(TAG, "mirror write failed", e)
            tmp.delete()
        }
    }
}
