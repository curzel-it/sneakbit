package it.curzel.bitscape.engine

import android.content.Context
import android.content.SharedPreferences
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

@Serializable
data class WorldRevisions(
    val revisions: Map<String, Long>
)

class WorldRevisionsStorage(private val context: Context) {

    private val kWorldsWithRevisions = "kWorldsWithRevisions"
    private val prefs: SharedPreferences = context.getSharedPreferences("WorldRevisionsStorage", Context.MODE_PRIVATE)
    private val json = Json { encodeDefaults = true }

    fun store(revision: UInt, worldId: UInt) {
        val allValues = allStoredValues().toMutableMap()
        allValues[worldId] = revision
        val data = WorldRevisions(
            revisions = allValues.mapKeys { it.key.toString() }.mapValues { it.value.toLong() }
        )
        val jsonString = json.encodeToString(data)
        prefs.edit().putString(kWorldsWithRevisions, jsonString).apply()
    }

    fun lastKnownRevision(worldId: UInt): UInt {
        return allStoredValues()[worldId] ?: 0u
    }

    private fun allStoredValues(): Map<UInt, UInt> {
        val stored = prefs.getString(kWorldsWithRevisions, null) ?: return emptyMap()
        val data = json.decodeFromString<WorldRevisions>(stored)
        return data.revisions.mapNotNull {
            val key = it.key.toUIntOrNull()
            val value = "$it.value".toUIntOrNull()
            if (key != null && value != null) key to value else null
        }.toMap()
    }

    fun getDisplayScale(): Float {
        return context.resources.displayMetrics.density
    }
}
