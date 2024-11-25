import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.controller.ControllerOffsetAxis
import it.curzel.bitscape.controller.ControllerOrientation
import it.curzel.bitscape.controller.ControllerSettingsStorage
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.controller.JoystickView
import it.curzel.bitscape.controller.KeyEmulatorView
import it.curzel.bitscape.controller.keyEmulatorViewPadding
import it.curzel.bitscape.controller.keyEmulatorViewSize
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@Composable
fun ControllerEmulatorView(
    gameEngine: GameEngine,
    settingsStorage: ControllerSettingsStorage,
    modifier: Modifier = Modifier
) {
    val configuration = LocalConfiguration.current
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val screenSize = IntSize(configuration.screenWidthDp, configuration.screenHeightDp)

    val viewModel = remember { ControllerEmulatorViewModel(gameEngine, settingsStorage, screenSize) }
    val isConfirmVisible by viewModel.isConfirmVisible.collectAsState()
    val isAttackVisible by viewModel.isAttackVisible.collectAsState()
    val attackLabel by viewModel.attackLabel.collectAsState()
    val currentOffset by viewModel.currentOffset.collectAsState()

    ControllerEmulatorView(
        isLandscape,
        isConfirmVisible,
        isAttackVisible,
        attackLabel,
        currentOffset,
        setKeyUp = { gameEngine.setKeyUp(it) },
        setKeyDown = { gameEngine.setKeyDown(it) },
        setDragging = { viewModel.setDragging(it) },
        updateDragOffset = { viewModel.updateDragOffset(it) },
        saveOffset = { landscape, size -> viewModel.saveOffset(landscape) },
        modifier
    )
}



@Composable
private fun ControllerEmulatorView(
    isLandscape: Boolean,
    isConfirmVisible: Boolean,
    isAttackVisible: Boolean,
    attackLabel: String,
    currentOffset: Offset,
    setKeyUp: (EmulatedKey) -> Unit,
    setKeyDown: (EmulatedKey) -> Unit,
    setDragging: (Boolean) -> Unit,
    updateDragOffset: (Offset) -> Unit,
    saveOffset: (Boolean, IntSize) -> Unit,
    modifier: Modifier = Modifier
) {

    Box(modifier = modifier.fillMaxSize()) {
        JoystickView(setKeyDown = { setKeyDown(it) }, setKeyUp = { setKeyUp(it) })

        Row(
            horizontalArrangement = Arrangement.spacedBy(0.dp),
            verticalAlignment = Alignment.Bottom,
            modifier = Modifier
                //.fillMaxHeight()
                .offset { IntOffset(currentOffset.x.roundToInt(), currentOffset.y.roundToInt()) }
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = {
                            setDragging(true)
                        },
                        onDrag = { change, dragAmount ->
                            change.consume()
                            updateDragOffset(dragAmount)
                        },
                        onDragEnd = {
                            setDragging(false)
                            saveOffset(isLandscape, this.size)
                        },
                        onDragCancel = {
                            setDragging(false)
                        }
                    )
                }
        ) {
            // Spacer(modifier = Modifier.weight(1.0f))

            AnimatedVisibility(
                visible = isConfirmVisible,
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                KeyEmulatorView(key = EmulatedKey.CONFIRM, onKeyDown = { setKeyDown(it) })
            }
            AnimatedVisibility(
                visible = isAttackVisible,
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                Box {
                    KeyEmulatorView(key = EmulatedKey.ATTACK, onKeyDown = { setKeyDown(it) })
                    Text(
                        text = attackLabel,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 12.dp)
                            .padding(bottom = keyEmulatorViewPadding),
                        textAlign = TextAlign.Center,
                        style = DSTypography.buttonCaption,
                        color = Color.Black.copy(alpha = 0.9f)
                    )
                }
            }
        }
    }
}

class ControllerEmulatorViewModel(
    private val engine: GameEngine,
    private val settingsStorage: ControllerSettingsStorage,
    private val screenSize: IntSize
) : ViewModel() {
    private val _isConfirmVisible = MutableStateFlow(false)
    val isConfirmVisible: StateFlow<Boolean> = _isConfirmVisible.asStateFlow()

    private val _isAttackVisible = MutableStateFlow(false)
    val isAttackVisible: StateFlow<Boolean> = _isAttackVisible.asStateFlow()

    private val _attackLabel = MutableStateFlow("")
    val attackLabel: StateFlow<String> = _attackLabel.asStateFlow()

    private val _currentOffset = MutableStateFlow(Offset.Zero)
    val currentOffset: StateFlow<Offset> = _currentOffset.asStateFlow()

    private var savedOffsetPortrait = Offset(
        x = settingsStorage.offset(axis = ControllerOffsetAxis.X, orientation = ControllerOrientation.PORTRAIT),
        y = settingsStorage.offset(axis = ControllerOffsetAxis.Y, orientation = ControllerOrientation.PORTRAIT)
    )
    private var savedOffsetLandscape = Offset(
        x = settingsStorage.offset(axis = ControllerOffsetAxis.X, orientation = ControllerOrientation.LANDSCAPE),
        y = settingsStorage.offset(axis = ControllerOffsetAxis.Y, orientation = ControllerOrientation.LANDSCAPE)
    )

    private var isDraggingInternal: Boolean = false

    init {
        observeKunaiCount()
        observeInteractionAvailable()
    }

    private fun observeKunaiCount() {
        viewModelScope.launch {
            engine.numberOfKunai()
                .collect { count ->
                    _isAttackVisible.value = count > 0
                    _attackLabel.value = "x$count"
                }
        }
    }

    private fun observeInteractionAvailable() {
        viewModelScope.launch {
            engine.isInteractionEnabled()
                .collect { available ->
                    _isConfirmVisible.value = available
                }
        }
    }

    fun setDragging(isDragging: Boolean) {
        isDraggingInternal = isDragging
    }

    fun updateDragOffset(dragAmount: Offset) {
        _currentOffset.value += dragAmount
    }

    fun saveOffset(isLandscape: Boolean) {
        val keyWidth = keyEmulatorViewSize.value
        val keyHeight = keyEmulatorViewSize.value

        val maxX = screenSize.width / 2f - keyWidth
        val maxY = screenSize.height / 2f - keyHeight - 50f
        val minX = -screenSize.width / 2f + keyWidth
        val minY = -screenSize.height / 2f + keyHeight * 2

        val newOffset = if (isLandscape) {
            savedOffsetLandscape + _currentOffset.value
        } else {
            savedOffsetPortrait + _currentOffset.value
        }

        val clampedOffset = Offset(
            x = newOffset.x.coerceIn(minX, maxX),
            y = newOffset.y.coerceIn(minY, maxY)
        )

        if (isLandscape) {
            savedOffsetLandscape = clampedOffset
            settingsStorage.store(offset = clampedOffset.x, axis = ControllerOffsetAxis.X, orientation = ControllerOrientation.LANDSCAPE)
            settingsStorage.store(offset = clampedOffset.y, axis = ControllerOffsetAxis.Y, orientation = ControllerOrientation.LANDSCAPE)
        } else {
            savedOffsetPortrait = clampedOffset
            settingsStorage.store(offset = clampedOffset.x, axis = ControllerOffsetAxis.X, orientation = ControllerOrientation.PORTRAIT)
            settingsStorage.store(offset = clampedOffset.y, axis = ControllerOffsetAxis.Y, orientation = ControllerOrientation.PORTRAIT)
        }
        _currentOffset.value = clampedOffset
    }
}

@Preview(showBackground = true)
@Composable
fun ControllerEmulatorViewPreview() {
    ControllerEmulatorView(
        isLandscape = false,
        isConfirmVisible = true,
        isAttackVisible = true,
        attackLabel = "x99",
        currentOffset = Offset.Zero,
        setKeyDown = {},
        setKeyUp = {},
        setDragging = {},
        updateDragOffset = {},
        saveOffset = { _, _ -> },
        modifier = Modifier
    )
}

@Preview(showBackground = true)
@Composable
fun ControllerEmulatorViewOnlyAttackPreview() {
    ControllerEmulatorView(
        isLandscape = false,
        isConfirmVisible = false,
        isAttackVisible = true,
        attackLabel = "x99",
        currentOffset = Offset.Zero,
        setKeyDown = {},
        setKeyUp = {},
        setDragging = {},
        updateDragOffset = {},
        saveOffset = { _, _ -> },
        modifier = Modifier
    )
}

@Preview(showBackground = true)
@Composable
fun ControllerEmulatorViewOnlyConfirmPreview() {
    ControllerEmulatorView(
        isLandscape = false,
        isConfirmVisible = true,
        isAttackVisible = false,
        attackLabel = "",
        currentOffset = Offset.Zero,
        setKeyDown = {},
        setKeyUp = {},
        setDragging = {},
        updateDragOffset = {},
        saveOffset = { _, _ -> },
        modifier = Modifier
    )
}

// Extension function for adding two Offsets
private operator fun Offset.plus(other: Offset): Offset {
    return Offset(this.x + other.x, this.y + other.y)
}
