package it.curzel.bitscape.rendering

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import it.curzel.bitscape.gamecore.IntRect
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.gamecore.RenderableItem
import java.io.IOException

class SpritesProvider(private val context: Context, private val spriteSheetFileNames: Map<UInt, String>) {
    private data class CacheKey(val spriteSheetID: UInt, val rect: IntRect)

    private val cache = mutableMapOf<CacheKey, Bitmap>()
    private val spriteSheetImages = mutableMapOf<UInt, Bitmap>()

    fun bitmapFor(spriteSheetID: UInt, textureRect: IntRect): Bitmap? {
        val cacheKey = CacheKey(spriteSheetID, textureRect)

        cache[cacheKey]?.let { return it }

        val sheetImage = loadSpriteSheetImage(spriteSheetID) ?: return null

        val rect = Rect(
            textureRect.x * NativeLib.TILE_SIZE,
            textureRect.y * NativeLib.TILE_SIZE,
            (textureRect.x + textureRect.w) * NativeLib.TILE_SIZE,
            (textureRect.y + textureRect.h) * NativeLib.TILE_SIZE
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