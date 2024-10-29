package it.curzel.bitscape.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import it.curzel.bitscape.gamecore.BiomeTile
import it.curzel.bitscape.gamecore.ConstructionTile
import it.curzel.bitscape.gamecore.IntRect
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.rendering.SpritesProvider

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

        val composedBitmap = Bitmap.createBitmap(mapWidth.toInt(), mapHeight.toInt(), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(composedBitmap)
        val paint = Paint().apply {
            isFilterBitmap = false
        }

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

        return composedBitmap
    }

    private fun renderTileImage(bitmap: Bitmap, frame: RectF, canvas: Canvas, paint: Paint) {
        canvas.save()
        canvas.translate(frame.left, frame.bottom)
        canvas.drawBitmap(bitmap, 0f, 0f, paint)
        canvas.restore()
    }
}
