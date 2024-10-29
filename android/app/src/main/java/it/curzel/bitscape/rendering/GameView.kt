package it.curzel.bitscape.rendering

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.util.Size
import android.view.Choreographer
import android.view.View
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.gamecore.RenderableItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class GameView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs), Choreographer.FrameCallback {

    lateinit var spritesProvider: SpritesProvider
    lateinit var engine: GameEngine

    private var lastUpdateTime: Long = 0L
    private var choreographer: Choreographer = Choreographer.getInstance()
    private var isRunning: Boolean = false

    init {
        setBackgroundColor(Color.BLACK)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        lastUpdateTime = System.nanoTime()
        startFrameCallback()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        CoroutineScope(Dispatchers.Main).launch {
            val size = Size(w, h)
            engine.setupChanged(null, size)
        }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        stopFrameCallback()
    }

    private fun startFrameCallback() {
        if (!isRunning) {
            isRunning = true
            choreographer.postFrameCallback(this)
        }
    }

    private fun stopFrameCallback() {
        if (isRunning) {
            isRunning = false
            choreographer.removeFrameCallback(this)
        }
    }

    override fun doFrame(frameTimeNanos: Long) {
        if (!isRunning) return
        val deltaTime = (frameTimeNanos - lastUpdateTime) / 1_000_000_000.0
        lastUpdateTime = frameTimeNanos
        engine.update(deltaTime.toFloat())
        invalidate()
        choreographer.postFrameCallback(this)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.BLACK)

        if (engine.canRender) {
            renderTileMap(canvas)
            renderEntities(canvas)
            renderDebugInfo(canvas)
        }
    }

    private fun renderEntities(canvas: Canvas) {
        engine.renderableItems().forEach { entity ->
            render(entity, canvas)
        }
    }

    private fun render(entity: RenderableItem, canvas: Canvas) {
        val bitmap = spritesProvider.bitmapFor(entity) ?: return
        val frame = engine.renderingFrame(entity)
        renderTexture(bitmap, frame, canvas)
    }

    private fun renderTexture(bitmap: Bitmap, frame: RectF, canvas: Canvas) {
        val saveCount = canvas.save()
        canvas.translate(frame.left, frame.top)
        canvas.scale(1f, -1f)
        canvas.translate(0f, -frame.height())
        canvas.drawBitmap(bitmap, null, RectF(0f, 0f, frame.width(), frame.height()), null)
        canvas.restoreToCount(saveCount)
    }

    private fun renderDebugInfo(canvas: Canvas) {
        val fps = engine.fps.toInt()
        val fpsText = "FPS: $fps   "
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
        val tileMapBitmap = engine.tileMapImage() ?: return
        val cameraViewport = engine.cameraViewport
        val cameraOffset = engine.cameraViewportOffset
        val tileSize = NativeLib.TILE_SIZE * engine.renderingScale
        val scaledMapWidth = tileMapBitmap.width * engine.renderingScale
        val scaledMapHeight = tileMapBitmap.height * engine.renderingScale
        val offsetX = -cameraViewport.x * tileSize - cameraOffset.x * engine.renderingScale
        val offsetY = -cameraViewport.y * tileSize - cameraOffset.y * engine.renderingScale

        val saveCount = canvas.save()
        canvas.translate(offsetX, offsetY)
        canvas.drawBitmap(tileMapBitmap, null, RectF(0f, 0f,scaledMapWidth, scaledMapHeight), null)
        canvas.restoreToCount(saveCount)
    }
}
