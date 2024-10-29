package it.curzel.bitscape.rendering

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import java.io.IOException

class SpritesProvider(private val context: Context, private val spriteSheetFileNames: Map<UInt, String>) {

    private data class CacheKey(val spriteSheetID: UInt, val rect: IntRect)

    private val cache = mutableMapOf<CacheKey, Bitmap>()
    private val spriteSheetImages = mutableMapOf<UInt, Bitmap>()

    companion object {
        const val TILE_SIZE = 32 // Adjust this value as needed
    }

    fun bitmapFor(spriteSheetID: UInt, textureRect: IntRect): Bitmap? {
        val cacheKey = CacheKey(spriteSheetID, textureRect)

        cache[cacheKey]?.let { return it }

        val sheetImage = loadSpriteSheetImage(spriteSheetID) ?: return null

        val rect = Rect(
            textureRect.x * TILE_SIZE,
            textureRect.y * TILE_SIZE,
            (textureRect.x + textureRect.width) * TILE_SIZE,
            (textureRect.y + textureRect.height) * TILE_SIZE
        )

        val width = rect.width()
        val height = rect.height()

        val croppedBitmap = Bitmap.createBitmap(sheetImage, rect.left, rect.top, width, height)
        cache[cacheKey] = croppedBitmap
        return croppedBitmap
    }

    private fun loadSpriteSheetImage(spriteSheetID: UInt): Bitmap? {
        spriteSheetImages[spriteSheetID]?.let { return it }

        val fileName = spriteSheetFileNames[spriteSheetID] ?: return null

        return try {
            context.assets.open("assets/$fileName.png").use { inputStream ->
                BitmapFactory.decodeStream(inputStream)?.also {
                    spriteSheetImages[spriteSheetID] = it
                }
            }
        } catch (e: IOException) {
            e.printStackTrace()
            null
        }
    }

    fun bitmapFor(entity: RenderableItem): Bitmap? {
        return bitmapFor(entity.spriteSheetId, entity.textureRect)
    }
}

data class IntRect(val x: Int, val y: Int, val width: Int, val height: Int)

data class RenderableItem(val spriteSheetId: UInt, val textureRect: IntRect)
