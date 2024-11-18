package it.curzel.bitscape.rendering

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.util.AttributeSet
import android.util.Size
import android.view.Choreographer
import android.view.View
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import it.curzel.bitscape.BuildConfig
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.gamecore.IntRect
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.gamecore.RenderableItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Composable
fun GameViewComposable(
    engine: GameEngine,
    spritesProvider: SpritesProvider,
    modifier: Modifier = Modifier
) {
    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { context ->
            GameView(context).apply {
                this.engine = engine
                this.spritesProvider = spritesProvider
            }
        }
    )
}

class GameView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs), Choreographer.FrameCallback {

    lateinit var spritesProvider: SpritesProvider
    lateinit var engine: GameEngine

    private var lastUpdateTime: Long = 0L
    private var choreographer: Choreographer = Choreographer.getInstance()
    private var isRunning: Boolean = false

    private val paint = Paint().apply {
        isAntiAlias = false
    }

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
            engine.setupChanged(Size(w, h))
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
        canvas.drawColor(0xFF000000)

        if (engine.canRender) {
            renderTileMap(canvas)
            renderNight(canvas)
            renderEntities(canvas)
            renderLimitedVisibility(canvas)

            if (BuildConfig.DEBUG) {
                renderDebugInfo(canvas)
            }
        }
    }

    private fun renderLimitedVisibility(canvas: Canvas) {
        if (!engine.isLimitedVisibility()) { return }

        paint.color = 0xFF000000.toInt()

        val canvasWidth = canvas.width.toFloat()
        val canvasHeight = canvas.height.toFloat()

        val centerX = canvasWidth / 2f
        val centerY = canvasHeight / 2f

        val tileSize = NativeLib.TILE_SIZE.toFloat() * engine.renderingScale
        val visibleAreaSize = tileSize * 9.0f
        val visibleAreaHalf = visibleAreaSize / 2f
        val halfTile = tileSize / 2f

        val visibleAreaRect = RectF(
            halfTile + centerX - visibleAreaHalf,
            centerY - visibleAreaHalf,
            halfTile + centerX + visibleAreaHalf,
            centerY + visibleAreaHalf
        )

        canvas.drawRect(0f, -200f, canvasWidth, visibleAreaRect.top, paint)
        canvas.drawRect(0f, visibleAreaRect.bottom, canvasWidth, canvasHeight + 200f, paint)
        canvas.drawRect(-200f, visibleAreaRect.top, visibleAreaRect.left, visibleAreaRect.bottom, paint)
        canvas.drawRect(visibleAreaRect.right, visibleAreaRect.top, canvasWidth + 200f, visibleAreaRect.bottom, paint)

        val spriteId = NativeLib.SPRITE_SHEET_CAVE_DARKNESS
        val textureRect = IntRect(0, 0, 10, 10)
        spritesProvider.bitmapFor(spriteId, textureRect)?.let {
            renderTexture(it, visibleAreaRect, canvas)
        }
    }

    private fun renderNight(canvas: Canvas) {
        if (!engine.isNight()) { return }
        canvas.drawColor(0x80000000)
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
