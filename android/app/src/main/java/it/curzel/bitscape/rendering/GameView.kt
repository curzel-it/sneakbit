package it.curzel.bitscape.rendering

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View

class GameView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    lateinit var spritesProvider: SpritesProvider
    lateinit var engine: GameEngine

    init {
        setBackgroundColor(Color.BLACK)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        // Clear the canvas with black color
        canvas.drawColor(Color.BLACK)

        if (engine.canRender) {
            renderTileMap(canvas)
            renderEntities(canvas)
            renderDebugInfo(canvas)
        }

        // Request the next frame
        postInvalidateOnAnimation()
    }

    private fun renderEntities(canvas: Canvas) {
        engine.renderEntities { entity ->
            render(entity, canvas)
        }
    }

    private fun render(entity: RenderableItem, canvas: Canvas) {
        val bitmap = spritesProvider.bitmapFor(entity) ?: return
        val frame = engine.renderingFrameFor(entity)
        renderTexture(bitmap, frame, canvas)
    }

    private fun renderTexture(bitmap: Bitmap, frame: RectF, canvas: Canvas) {
        val saveCount = canvas.save()

        // Apply transformations if needed (e.g., flipping)
        canvas.translate(frame.left, frame.top)
        canvas.scale(1f, -1f)
        canvas.translate(0f, -frame.height())

        // Draw the bitmap
        canvas.drawBitmap(bitmap, null, RectF(0f, 0f, frame.width(), frame.height()), null)

        canvas.restoreToCount(saveCount)
    }

    private fun renderDebugInfo(canvas: Canvas) {
        val fpsText = String.format("\nFPS: %.0f   ", engine.fps)
        val paint = Paint().apply {
            color = Color.WHITE
            textSize = 14f * resources.displayMetrics.density
            typeface = Typeface.MONOSPACE
            isAntiAlias = true
        }
        val textWidth = paint.measureText(fpsText)
        val x = width - textWidth - 10 * resources.displayMetrics.density
        val y = 10 * resources.displayMetrics.density - paint.ascent()
        canvas.drawText(fpsText, x, y, paint)
    }

    private fun renderTileMap(canvas: Canvas) {
        val tileMapBitmap = engine.tileMapBitmap() ?: return

        val cameraViewport = engine.cameraViewport
        val cameraOffset = engine.cameraViewportOffset
        val tileSize = TILE_SIZE * engine.renderingScale
        val scaledMapSize = SizeF(
            tileMapBitmap.width * engine.renderingScale,
            tileMapBitmap.height * engine.renderingScale
        )

        val offsetX = -cameraViewport.x * tileSize - cameraOffset.x * engine.renderingScale
        val offsetY = -cameraViewport.y * tileSize - cameraOffset.y * engine.renderingScale

        val saveCount = canvas.save()

        canvas.translate(offsetX, offsetY)
        canvas.drawBitmap(tileMapBitmap, null, RectF(0f, 0f, scaledMapSize.width, scaledMapSize.height), null)

        canvas.restoreToCount(saveCount)
    }

    companion object {
        private const val TILE_SIZE = 32f  // Define your tile size here
    }
}

// Additional helper classes and interfaces
data class SizeF(val width: Float, val height: Float)


