package it.curzel.bitscape.controller

import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import it.curzel.bitscape.R
import it.curzel.bitscape.engine.SomeGameEngine
import kotlin.math.*

@Composable
fun JoystickView(
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current
    val viewModel = remember { JoystickViewModel(gameEngine, density) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { offset ->
                        viewModel.handleDragStarted(offset)
                    },
                    onDrag = { change, _ ->
                        change.consume()
                        viewModel.handleDragChanged(change.position)
                    },
                    onDragEnd = {
                        viewModel.handleDragEnded()
                    },
                    onDragCancel = {
                        viewModel.handleDragEnded()
                    }
                )
            }
    ) {
        if (viewModel.isDragging) {
            Image(
                bitmap = ImageBitmap.imageResource(R.drawable.joystick),
                contentDescription = "Joystick Base",
                contentScale = ContentScale.FillBounds,
                modifier = Modifier
                    .size(viewModel.baseRadius * 2)
                    .graphicsLayer {
                        translationX = viewModel.center.x - viewModel.baseRadiusPx
                        translationY = viewModel.center.y - viewModel.baseRadiusPx
                    },
                filterQuality = FilterQuality.None
            )
            Image(
                bitmap = ImageBitmap.imageResource(R.drawable.joystick_lever),
                contentDescription = "Joystick Lever",
                contentScale = ContentScale.FillBounds,
                modifier = Modifier
                    .size(viewModel.leverRadius * 2)
                    .graphicsLayer {
                        translationX = viewModel.dragLocation.x - viewModel.leverRadiusPx
                        translationY = viewModel.dragLocation.y - viewModel.leverRadiusPx
                    },
                filterQuality = FilterQuality.None
            )
        }
    }
}

class JoystickViewModel(
    private val engine: SomeGameEngine,
    density: Density
) {
    var dragLocation by mutableStateOf(Offset.Zero)
    var isDragging by mutableStateOf(false)
    var currentActiveKey: EmulatedKey? by mutableStateOf(null)
    var center by mutableStateOf(Offset.Zero)

    val baseRadius: Dp = 32.dp
    val leverRadius: Dp = 16.dp
    val maxDistance: Dp = 16.dp
    val maxFingerDistance: Dp = 48.dp

    val baseRadiusPx: Float
    val leverRadiusPx: Float
    val maxDistancePx: Float
    val maxFingerDistancePx: Float

    private val movesAlongWithGesture = true

    init {
        with(density) {
            baseRadiusPx = baseRadius.toPx()
            leverRadiusPx = leverRadius.toPx()
            maxDistancePx = maxDistance.toPx()
            maxFingerDistancePx = maxFingerDistance.toPx()
        }
    }

    fun handleDragStarted(startLocation: Offset) {
        if (!isDragging) {
            isDragging = true
            center = startLocation
            dragLocation = startLocation
        }
    }

    fun handleDragChanged(position: Offset) {
        if (!isDragging) return

        var vector = Offset(
            x = position.x - center.x,
            y = position.y - center.y
        )
        var realDistance = vector.getDistance()
        var updatedCenter = center

        if (movesAlongWithGesture && realDistance > maxFingerDistancePx) {
            val angle = vector.getAngle()
            val excessDistance = realDistance - maxFingerDistancePx
            updatedCenter = Offset(
                x = center.x + cos(angle) * excessDistance,
                y = center.y + sin(angle) * excessDistance
            )
            vector = Offset(
                x = position.x - updatedCenter.x,
                y = position.y - updatedCenter.y
            )
            realDistance = vector.getDistance()
        }

        val distance = min(realDistance, maxDistancePx)
        val angle = vector.getAngle()
        val limitedX = updatedCenter.x + cos(angle) * distance
        val limitedY = updatedCenter.y + sin(angle) * distance
        dragLocation = Offset(x = limitedX, y = limitedY)
        center = updatedCenter

        handleDirection(angle = angle)
    }

    fun handleDragEnded() {
        isDragging = false
        releaseCurrentKey()
    }

    private fun handleDirection(angle: Float) {
        val adjustedAngle = if (angle < 0) angle + 2 * PI.toFloat() else angle
        val pi = PI.toFloat()

        val newActiveKey: EmulatedKey? = when {
            (7 * pi / 4 <= adjustedAngle && adjustedAngle <= 2 * pi) || (0 <= adjustedAngle && adjustedAngle <= pi / 4) -> EmulatedKey.RIGHT
            (pi / 4 < adjustedAngle && adjustedAngle <= 3 * pi / 4) -> EmulatedKey.DOWN
            (3 * pi / 4 < adjustedAngle && adjustedAngle <= 5 * pi / 4) -> EmulatedKey.LEFT
            (5 * pi / 4 < adjustedAngle && adjustedAngle <= 7 * pi / 4) -> EmulatedKey.UP
            else -> null
        }

        if (currentActiveKey != newActiveKey) {
            currentActiveKey?.let { engine.setKeyUp(it) }
            newActiveKey?.let { engine.setKeyDown(it) }
            currentActiveKey = newActiveKey
        }
    }

    private fun releaseCurrentKey() {
        currentActiveKey?.let { engine.setKeyUp(it) }
        currentActiveKey = null
    }

    private fun Offset.getAngle(): Float = atan2(this.y, this.x)
}
