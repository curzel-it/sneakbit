package it.curzel.bitscape.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import it.curzel.bitscape.gamecore.NativeLib
import java.io.File
import java.io.FileOutputStream

class TileMapsStorage(private val context: Context) {

    companion object {
        private const val STORAGE_DIR_NAME = "TileMaps"
    }

    private val storageDirectory: File

    init {
        val caches = context.cacheDir
        storageDirectory = File(caches, STORAGE_DIR_NAME)

        if (!storageDirectory.exists()) {
            storageDirectory.mkdirs()
        }
    }

    fun store(images: List<Bitmap>, worldId: UInt, revision: UInt) {
        images.forEachIndexed { variant, image ->
            val filename = "${worldId}-${revision}-${variant}.png"
            val file = File(storageDirectory, filename)
            try {
                FileOutputStream(file).use { out ->
                    image.compress(Bitmap.CompressFormat.PNG, 100, out)
                }
            } catch (e: Exception) {
                // Optionally handle the exception (e.g., log it)
            }
        }
    }

    fun images(worldId: UInt, revision: UInt): List<Bitmap> {
        return (0..NativeLib.BIOME_NUMBER_OF_FRAMES).mapNotNull { variant ->
            val filename = "${worldId}-${revision}-${variant}.png"
            val file = File(storageDirectory, filename)
            if (file.exists()) {
                BitmapFactory.decodeFile(file.absolutePath)
            } else {
                null
            }
        }
    }
}
