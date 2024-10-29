package it.curzel.bitscape.controller

import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import it.curzel.bitscape.R
import it.curzel.bitscape.engine.MockGameEngine
import it.curzel.bitscape.engine.SomeGameEngine

@Composable
fun JoystickView(
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { JoystickViewModel(gameEngine) }
    Box(
        modifier = modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { offset ->
                        viewModel.handleDragStart(offset)
                    },
                    onDrag = { change, dragAmount ->
                        change.consume()
                        viewModel.handleDrag(change.position)
                    },
                    onDragEnd = {
                        viewModel.handleDragEnd()
                    },
                    onDragCancel = {
                        viewModel.handleDragEnd()
                    }
                )
            }
    ) {
        if (viewModel.isDragging) {
            Image(
                painter = painterResource(id = R.drawable.joystick),
                contentDescription = "Joystick Base",
                modifier = Modifier
                    .size((viewModel.baseRadius * 2).dp)
                    .graphicsLayer {
                        translationX = viewModel.center.x - viewModel.baseRadius
                        translationY = viewModel.center.y - viewModel.baseRadius
                    }
            )
            Image(
                painter = painterResource(id = R.drawable.joystick_lever),
                contentDescription = "Joystick Lever",
                modifier = Modifier
                    .size((viewModel.leverRadius * 2).dp)
                    .graphicsLayer {
                        translationX = viewModel.dragLocation.x - viewModel.leverRadius
                        translationY = viewModel.dragLocation.y - viewModel.leverRadius
                    }
            )
        }
    }
}

class JoystickViewModel(private val engine: SomeGameEngine) {
    var dragLocation by mutableStateOf(Offset.Zero)
        private set

    var isDragging by mutableStateOf(false)
        private set

    var currentActiveKey: EmulatedKey? by mutableStateOf(null)
        private set

    var center by mutableStateOf(Offset.Zero)
        private set

    val baseRadius: Float = 32f
    val leverRadius: Float = 16f
    val maxDistance: Float = 16f
    val maxFingerDistance: Float = 48f

    private val movesAlongWithGesture = true

    fun handleDragStart(startLocation: Offset) {
        if (!isDragging) {
            isDragging = true
            center = startLocation
            dragLocation = startLocation
        }
    }

    fun handleDrag(location: Offset) {
        if (!isDragging) return

        var vector = Offset(
            x = location.x - center.x,
            y = location.y - center.y
        )
        var realDistance = vector.getDistance()

        if (movesAlongWithGesture && realDistance > maxFingerDistance) {
            val angle = vector.getAngle()
            val excessDistance = realDistance - maxFingerDistance
            center = Offset(
                x = center.x + kotlin.math.cos(angle) * excessDistance,
                y = center.y + kotlin.math.sin(angle) * excessDistance
            )
            vector = Offset(
                x = location.x - center.x,
                y = location.y - center.y
            )
            realDistance = vector.getDistance()
        }

        val distance = kotlin.math.min(realDistance, maxDistance)
        val angle = vector.getAngle()
        val limitedX = center.x + kotlin.math.cos(angle) * distance
        val limitedY = center.y + kotlin.math.sin(angle) * distance
        dragLocation = Offset(x = limitedX, y = limitedY)

        handleDirection(angle = angle)
    }

    fun handleDragEnd() {
        isDragging = false
        releaseCurrentKey()
    }

    private fun handleDirection(angle: Float) {
        val adjustedAngle = if (angle < 0) angle + 2 * kotlin.math.PI.toFloat() else angle
        val pi = kotlin.math.PI.toFloat()

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

    private fun Offset.getAngle(): Float {
        return kotlin.math.atan2(y, x)
    }
}