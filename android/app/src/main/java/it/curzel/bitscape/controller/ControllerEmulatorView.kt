import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
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
    val density = LocalDensity.current
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val screenSize = IntSize(
        (configuration.screenWidthDp.toFloat() * density.density).toInt(),
        (configuration.screenHeightDp.toFloat() * density.density).toInt()
    )

    val viewModel = remember { ControllerEmulatorViewModel(gameEngine, settingsStorage, screenSize) }

    LaunchedEffect(isLandscape) {
        viewModel.onOrientationChanged(isLandscape)
    }

    val isConfirmVisible by viewModel.isConfirmVisible.collectAsState()
    val isAttackVisible by viewModel.isAttackVisible.collectAsState()
    val attackLabel by viewModel.attackLabel.collectAsState()
    val currentOffset by viewModel.currentOffset.collectAsState()
    val confirmOnRight by viewModel.confirmOnRight.collectAsState()

    ControllerEmulatorView(
        isConfirmVisible = isConfirmVisible,
        isAttackVisible = isAttackVisible,
        attackLabel = attackLabel,
        currentOffset = currentOffset,
        confirmOnRight = confirmOnRight,
        setKeyUp = { gameEngine.setKeyUp(it) },
        setKeyDown = { gameEngine.setKeyDown(it) },
        updateDragOffset = { viewModel.updateDragOffset(it) },
        saveOffset = { viewModel.saveOffset() },
        modifier = modifier
    )
}

@Composable
private fun ControllerEmulatorView(
    isConfirmVisible: Boolean,
    isAttackVisible: Boolean,
    attackLabel: String,
    currentOffset: Offset,
    confirmOnRight: Boolean,
    setKeyUp: (EmulatedKey) -> Unit,
    setKeyDown: (EmulatedKey) -> Unit,
    updateDragOffset: (Offset) -> Unit,
    saveOffset: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier.fillMaxSize()) {
        JoystickView(setKeyDown = { setKeyDown(it) }, setKeyUp = { setKeyUp(it) })

        Row(
            horizontalArrangement = Arrangement.spacedBy(0.dp),
            verticalAlignment = Alignment.Bottom,
            modifier = Modifier
                .offset {
                    val confirmButtonCorrection = if (isConfirmVisible && !confirmOnRight) {
                        keyEmulatorViewSize.toPx().roundToInt()
                    } else {
                        0
                    }

                    IntOffset(
                        currentOffset.x.roundToInt() - confirmButtonCorrection,
                        currentOffset.y.roundToInt()
                    )
                }
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = {
                            // ...
                        },
                        onDrag = { change, dragAmount ->
                            change.consume()
                            updateDragOffset(dragAmount)
                        },
                        onDragEnd = {
                            saveOffset()
                        },
                        onDragCancel = {
                            // ...
                        }
                    )
                }
        ) {
            if (!confirmOnRight && isConfirmVisible) {
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
            if (confirmOnRight) {
                AnimatedVisibility(visible = isConfirmVisible, enter = fadeIn(), exit = fadeOut()) {
                    KeyEmulatorView(key = EmulatedKey.CONFIRM, onKeyDown = { setKeyDown(it) })
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

    private val _confirmOnRight = MutableStateFlow(false)
    val confirmOnRight: StateFlow<Boolean> = _confirmOnRight.asStateFlow()

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

    private var isLandscape: Boolean = false

    init {
        updateCurrentOffset()
        observeKunaiCount()
        observeInteractionAvailable()
    }

    fun onOrientationChanged(isLandscape: Boolean) {
        this.isLandscape = isLandscape
        updateCurrentOffset()
    }

    fun updateDragOffset(dragAmount: Offset) {
        _currentOffset.value += dragAmount
    }

    fun saveOffset() {
        val keyWidth = keyEmulatorViewSize.value
        val keyHeight = keyEmulatorViewSize.value

        val maxX = screenSize.width - keyWidth * 2.0f - 20.0f
        val maxY = screenSize.height - keyHeight - 50.0f
        val minX = 20.0f
        val minY = keyHeight * 2.0f

        val clampedOffset = Offset(
            x = _currentOffset.value.x.coerceIn(minX, maxX),
            y = _currentOffset.value.y.coerceIn(minY, maxY)
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
        setConfirmButtonPosition()
    }

    private fun setConfirmButtonPosition() {
        _confirmOnRight.value = currentOffset.value.x < screenSize.width / 2.0f
    }

    private fun updateCurrentOffset() {
        _currentOffset.value = if (isLandscape) savedOffsetLandscape else savedOffsetPortrait
        setConfirmButtonPosition()
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
}

@Preview(showBackground = true)
@Composable
fun ControllerEmulatorViewPreview() {
    ControllerEmulatorView(
        isConfirmVisible = true,
        isAttackVisible = true,
        attackLabel = "x99",
        currentOffset = Offset.Zero,
        confirmOnRight = true,
        setKeyDown = {},
        setKeyUp = {},
        updateDragOffset = {},
        saveOffset = {},
        modifier = Modifier
    )
}

@Preview(showBackground = true)
@Composable
fun ControllerEmulatorViewOnlyAttackPreview() {
    ControllerEmulatorView(
        isConfirmVisible = false,
        isAttackVisible = true,
        attackLabel = "x99",
        currentOffset = Offset.Zero,
        confirmOnRight = true,
        setKeyDown = {},
        setKeyUp = {},
        updateDragOffset = {},
        saveOffset = {},
        modifier = Modifier
    )
}

@Preview(showBackground = true)
@Composable
fun ControllerEmulatorViewOnlyConfirmPreview() {
    ControllerEmulatorView(
        isConfirmVisible = true,
        isAttackVisible = false,
        attackLabel = "",
        currentOffset = Offset.Zero,
        confirmOnRight = true,
        setKeyDown = {},
        setKeyUp = {},
        updateDragOffset = {},
        saveOffset = {},
        modifier = Modifier
    )
}
