package it.curzel.bitscape.engine

import android.content.Context
import android.graphics.*
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import it.curzel.bitscape.gamecore.BiomeTile
import it.curzel.bitscape.gamecore.ConstructionTile
import it.curzel.bitscape.gamecore.IntRect
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.rendering.SpritesProvider
import kotlin.math.roundToInt

fun Bitmap.flipVertically(): Bitmap {
    val matrix = Matrix().apply {
        preScale(1f, -1f)
    }
    return Bitmap.createBitmap(this, 0, 0, width, height, matrix, true)
}

class TileMapImageGenerator(private val spritesProvider: SpritesProvider) {
    fun generate(
        worldWidth: Int,
        worldHeight: Int,
        variant: Int,
        biomeTiles: Array<Array<BiomeTile>>,
        constructionTiles: Array<Array<ConstructionTile>>
    ): Bitmap? {
        if (biomeTiles.isEmpty() || constructionTiles.isEmpty()) return null
        if (worldWidth == 0 || worldHeight == 0) return null

        val tileSize = NativeLib.TILE_SIZE.toFloat()
        val mapWidth = worldWidth * tileSize
        val mapHeight = worldHeight * tileSize

        // Create a bitmap with the desired size
        val composedBitmap = Bitmap.createBitmap(mapWidth.toInt(), mapHeight.toInt(), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(composedBitmap)
        val paint = Paint().apply {
            isFilterBitmap = false // Equivalent to interpolationQuality = .none
        }

        // Draw Biome Tiles
        for (row in 0 until worldHeight) {
            for (col in 0 until worldWidth) {
                val biomeTile = biomeTiles[row][col]
                if (biomeTile.tileType == 0) continue

                val textureRect = IntRect(
                    x = biomeTile.textureOffsetX,
                    y = biomeTile.textureOffsetY + variant * NativeLib.NUMBER_OF_BIOMES,
                    w = 1,
                    h = 1
                )

                val bitmap = spritesProvider.bitmapFor(NativeLib.SPRITE_SHEET_BIOME_TILES, textureRect)
                bitmap?.let {
                    val frame = RectF(
                        col * tileSize,
                        row * tileSize,
                        (col + 1) * tileSize,
                        (row + 1) * tileSize
                    )
                    renderTileImage(it, frame, canvas, paint)
                }
            }
        }

        // Draw Construction Tiles
        for (row in 0 until worldHeight) {
            for (col in 0 until worldWidth) {
                val constructionTile = constructionTiles[row][col]
                if (constructionTile.tileType == 0) continue

                val sourceRect = constructionTile.textureSourceRect
                if (sourceRect.x != 0) {
                    val textureRect = IntRect(
                        x = sourceRect.x,
                        y = sourceRect.y,
                        w = sourceRect.w,
                        h = sourceRect.h
                    )

                    val bitmap = spritesProvider.bitmapFor(NativeLib.SPRITE_SHEET_CONSTRUCTION_TILES, textureRect)
                    bitmap?.let {
                        val frame = RectF(
                            col * tileSize,
                            row * tileSize,
                            (col + 1) * tileSize,
                            (row + 1) * tileSize
                        )
                        renderTileImage(it, frame, canvas, paint)
                    }
                }
            }
        }

        return composedBitmap // .flipVertically()
    }

    private fun renderTileImage(bitmap: Bitmap, frame: RectF, canvas: Canvas, paint: Paint) {
        canvas.save()
        canvas.translate(frame.left, frame.bottom)
        // canvas.scale(1f, -1f)
        canvas.drawBitmap(bitmap, 0f, 0f, paint)
        canvas.restore()
    }
}
