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
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import it.curzel.bitscape.R
import kotlin.math.*

@Composable
fun JoystickView(
    setKeyDown: (EmulatedKey) -> Unit,
    setKeyUp: (EmulatedKey) -> Unit,
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current
    val viewModel = remember { JoystickViewModel(setKeyDown, setKeyUp, density) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { offset ->
                        viewModel.handleDragStarted(offset)
                    },
                    onDrag = { change, _ ->
                        change.consume() // Consume the event to prevent further propagation
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
            // Joystick Base
            Image(
                bitmap = ImageBitmap.imageResource(R.drawable.joystick),
                contentDescription = "Joystick Base",
                contentScale = ContentScale.FillBounds,
                filterQuality = FilterQuality.None,
                modifier = Modifier
                    .size(viewModel.baseRadius * 2)
                    .graphicsLayer {
                        translationX = viewModel.center.x - viewModel.baseRadiusPx
                        translationY = viewModel.center.y - viewModel.baseRadiusPx
                    }
            )
            // Joystick Lever
            Image(
                bitmap = ImageBitmap.imageResource(R.drawable.joystick_lever),
                contentDescription = "Joystick Lever",
                contentScale = ContentScale.FillBounds,
                filterQuality = FilterQuality.None,
                modifier = Modifier
                    .size(viewModel.leverRadius * 2)
                    .graphicsLayer {
                        translationX = viewModel.dragLocation.x - viewModel.leverRadiusPx
                        translationY = viewModel.dragLocation.y - viewModel.leverRadiusPx
                    }
            )
        }
    }
}

class JoystickViewModel(
    private val setKeyDown: (EmulatedKey) -> Unit,
    private val setKeyUp: (EmulatedKey) -> Unit,
    density: Density
) {
    var dragLocation by mutableStateOf(Offset.Zero)
    var isDragging by mutableStateOf(false)
    var currentActiveKeys: MutableSet<EmulatedKey> = mutableSetOf()
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
        releaseCurrentKeys()
    }

    private fun handleDirection(angle: Float) {
        val adjustedAngle = (if (angle < 0) angle + 2 * PI.toFloat() else angle) / PI.toFloat()
        val newActiveKeys = directionForAngle(adjustedAngle)
        val keysToRelease = currentActiveKeys - newActiveKeys
        val keysToPress = newActiveKeys - currentActiveKeys

        keysToRelease.forEach { key ->
            setKeyUp(key)
            currentActiveKeys.remove(key)
        }
        keysToPress.forEach { key ->
            setKeyDown(key)
            currentActiveKeys.add(key)
        }
    }

    private fun directionForAngle(angle: Float): Set<EmulatedKey> {
        return when {
            (0f <= angle && angle <= 1/8f) || (15/8f <= angle && angle <= 2f) -> setOf(EmulatedKey.RIGHT)
            (1/8f < angle && angle <= 3/8f) -> setOf(EmulatedKey.RIGHT, EmulatedKey.DOWN)
            (3/8f < angle && angle <= 5/8f) -> setOf(EmulatedKey.DOWN)
            (5/8f < angle && angle <= 7/8f) -> setOf(EmulatedKey.DOWN, EmulatedKey.LEFT)
            (7/8f < angle && angle <= 9/8f) -> setOf(EmulatedKey.LEFT)
            (9/8f < angle && angle <= 11/8f) -> setOf(EmulatedKey.LEFT, EmulatedKey.UP)
            (11/8f < angle && angle <= 13/8f) -> setOf(EmulatedKey.UP)
            (13/8f < angle && angle <= 15/8f) -> setOf(EmulatedKey.UP, EmulatedKey.RIGHT)
            else -> emptySet()
        }
    }

    private fun releaseCurrentKeys() {
        currentActiveKeys.forEach { key ->
            setKeyUp(key)
        }
        currentActiveKeys.clear()
    }

    private fun Offset.getAngle(): Float = atan2(this.y, this.x)
}
