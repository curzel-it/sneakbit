package it.curzel.bitscape.engine

import android.content.Context
import android.graphics.*
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import it.curzel.bitscape.rendering.IntRect
import it.curzel.bitscape.rendering.SpritesProvider
import kotlin.math.roundToInt

// Assuming these constants are defined somewhere in your codebase
const val TILE_SIZE = 32 // Example tile size in pixels
const val SPRITE_SHEET_BIOME_TILES = 1
const val SPRITE_SHEET_CONSTRUCTION_TILES = 2

// Data classes (Assumed to be defined)
data class BiomeTile(
    val tile_type: Int,
    val texture_offset_x: Int,
    val texture_offset_y: Int
)

data class ConstructionTile(
    val tile_type: Int,
    val texture_source_rect: IntRect
)

// Extension function to flip a Bitmap vertically
fun Bitmap.flipVertically(): Bitmap {
    val matrix = Matrix().apply {
        preScale(1f, -1f)
    }
    return Bitmap.createBitmap(this, 0, 0, width, height, matrix, true)
}

class TileMapImageGenerator(private val spritesProvider: SpritesProvider) {
    private val numberOfBiomes: Int = 18

    fun generate(
        renderingScale: Float,
        worldWidth: Int,
        worldHeight: Int,
        variant: Int,
        biomeTiles: List<List<BiomeTile>>,
        constructionTiles: List<List<ConstructionTile>>
    ): Bitmap? {
        if (biomeTiles.isEmpty() || constructionTiles.isEmpty()) return null

        val tileSize = TILE_SIZE * renderingScale
        val mapWidth = (worldWidth * tileSize).roundToInt()
        val mapHeight = (worldHeight * tileSize).roundToInt()

        // Create a bitmap with the desired size
        val composedBitmap = Bitmap.createBitmap(mapWidth, mapHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(composedBitmap)
        val paint = Paint().apply {
            isFilterBitmap = false // Equivalent to interpolationQuality = .none
        }

        // Draw Biome Tiles
        for (row in 0 until worldHeight) {
            for (col in 0 until worldWidth) {
                val biomeTile = biomeTiles[row][col]
                if (biomeTile.tile_type == 0) continue

                val textureRect = IntRect(
                    x = biomeTile.texture_offset_x,
                    y = biomeTile.texture_offset_y + variant * numberOfBiomes,
                    w = 1,
                    h = 1
                )

                val bitmap = spritesProvider.bitmapFor(SPRITE_SHEET_BIOME_TILES.toUInt(), textureRect)
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
                if (constructionTile.tile_type == 0) continue

                val sourceRect = constructionTile.texture_source_rect
                if (sourceRect.x != 0) {
                    val textureRect = IntRect(
                        x = sourceRect.x,
                        y = sourceRect.y,
                        w = sourceRect.w,
                        h = sourceRect.h
                    )

                    val bitmap = spritesProvider.bitmapFor(SPRITE_SHEET_CONSTRUCTION_TILES.toUInt(), textureRect)
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

        return composedBitmap.flipVertically()
    }

    /**
     * Renders a single tile image onto the canvas within the specified frame.
     *
     * @param bitmap The bitmap image of the tile.
     * @param frame The destination rectangle on the canvas where the tile should be drawn.
     * @param canvas The Canvas to draw on.
     * @param paint The Paint object to use for drawing.
     */
    private fun renderTileImage(bitmap: Bitmap, frame: RectF, canvas: Canvas, paint: Paint) {
        // Save the current state of the canvas
        canvas.save()

        // Apply transformations: translate and scale to flip vertically
        canvas.translate(frame.left, frame.bottom)
        canvas.scale(1f, -1f)

        // Draw the bitmap into the transformed canvas
        canvas.drawBitmap(bitmap, 0f, 0f, paint)

        // Restore the canvas to its previous state
        canvas.restore()
    }
}

/**
 * Retrieves the current display scale (density) from the context.
 *
 * @param context The Android Context.
 * @return The scale factor as a Float.
 */
fun getDisplayScale(context: Context): Float {
    val metrics = context.resources.displayMetrics
    return metrics.density
}
