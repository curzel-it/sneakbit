import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.controller.JoystickView
import it.curzel.bitscape.controller.KeyEmulatorView
import it.curzel.bitscape.controller.keyEmulatorViewPadding
import it.curzel.bitscape.engine.SomeGameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

@Composable
fun ControllerEmulatorView(
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { ControllerEmulatorViewModel(gameEngine) }
    val configuration = LocalConfiguration.current
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val isConfirmVisible by viewModel.isConfirmVisible.collectAsState()
    val isAttackVisible by viewModel.isAttackVisible.collectAsState()
    val attackLabel by viewModel.attackLabel.collectAsState()

    ControllerEmulatorView(
        isLandscape,
        isConfirmVisible,
        isAttackVisible,
        attackLabel,
        setKeyDown = { viewModel.setKeyDown(it) },
        setKeyUp = { viewModel.setKeyUp(it) },
        modifier = modifier
    )
}

@Composable
private fun ControllerEmulatorView(
    isLandscape: Boolean,
    isConfirmVisible: Boolean,
    isAttackVisible: Boolean,
    attackLabel: String,
    setKeyDown: (EmulatedKey) -> Unit,
    setKeyUp: (EmulatedKey) -> Unit,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier.fillMaxSize()) {
        JoystickView(setKeyDown, setKeyUp)

        Row(
            horizontalArrangement = Arrangement.spacedBy(0.dp),
            verticalAlignment = Alignment.Bottom,
            modifier = Modifier
                .fillMaxHeight()
                .padding(start = if (isLandscape) 85.dp else 20.dp)
                .padding(bottom = if (isLandscape) 100.dp else 140.dp)
        ) {
            AnimatedVisibility(
                visible = isAttackVisible,
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                Box {
                    KeyEmulatorView(EmulatedKey.ATTACK, setKeyDown, setKeyUp)
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

            AnimatedVisibility(
                visible = isConfirmVisible,
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                KeyEmulatorView(EmulatedKey.CONFIRM, setKeyDown, setKeyUp)
            }
        }
    }
}

class ControllerEmulatorViewModel(
    private val engine: SomeGameEngine
) : ViewModel() {
    private val _isConfirmVisible = MutableStateFlow(false)
    val isConfirmVisible: StateFlow<Boolean> = _isConfirmVisible.asStateFlow()

    private val _isAttackVisible = MutableStateFlow(false)
    val isAttackVisible: StateFlow<Boolean> = _isAttackVisible.asStateFlow()

    private val _attackLabel = MutableStateFlow("")
    val attackLabel: StateFlow<String> = _attackLabel.asStateFlow()

    init {
        observeKunaiCount()
        observeInteractionAvailable()
    }

    fun setKeyDown(key: EmulatedKey) {
        engine.setKeyDown(key)
    }

    fun setKeyUp(key: EmulatedKey) {
        engine.setKeyUp(key)
    }

    private fun observeKunaiCount() {
        viewModelScope.launch {
            engine.numberOfKunai()
                .distinctUntilChanged { old, new -> old == new }
                .collect { count ->
                    _isAttackVisible.value = count > 0
                    _attackLabel.value = "x$count"
                }
        }
    }

    private fun observeInteractionAvailable() {
        viewModelScope.launch {
            engine.isInteractionEnabled()
                .distinctUntilChanged { old, new -> old == new }
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
        isLandscape = false,
        isConfirmVisible = true,
        isAttackVisible = true,
        attackLabel = "x99",
        setKeyDown = {},
        setKeyUp = {},
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
        setKeyDown = {},
        setKeyUp = {},
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
        setKeyDown = {},
        setKeyUp = {},
        modifier = Modifier
    )
}
