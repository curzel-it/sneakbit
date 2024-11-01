package it.curzel.bitscape.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import it.curzel.bitscape.gamecore.NativeLib
import java.io.IOException

class TileMapsStorage(private val context: Context) {
    private val cache = HashMap<UInt, List<Bitmap>>()

    fun images(worldId: UInt): List<Bitmap> {
        cache[worldId]?.let {
            return it
        }
        val images = (0..NativeLib.BIOME_NUMBER_OF_FRAMES).mapNotNull { variant ->
            val path = "assets/$worldId-$variant.png"
            try {
                context.assets.open(path).use { inputStream ->
                    return@mapNotNull BitmapFactory.decodeStream(inputStream)
                }
            } catch (e: IOException) {
                e.printStackTrace()
                return@mapNotNull null
            }
        }
        cache[worldId] = images
        return images
    }
}