package it.curzel.bitscape.rendering

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.R
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import it.curzel.bitscape.ui.theme.MenuBackground
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

@Composable
fun MessageView(
    gameEngine: GameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { MessageViewModel(gameEngine) }
    val isVisible by viewModel.isVisible
    val title by viewModel.title
    val text by viewModel.text

    MessageView(
        isVisible = isVisible,
        title = title,
        text = text,
        onCancel = { viewModel.cancel() },
        onConfirm = { viewModel.confirm() },
        modifier = modifier
    )
}

@Composable
private fun MessageView(
    isVisible: Boolean,
    title: String,
    text: String,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(
        visible = isVisible,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = modifier.fillMaxSize()
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.4f))
                .padding(24.dp)
                .padding(bottom = 24.dp)
                .clickable { onCancel() },
            contentAlignment = Alignment.BottomCenter
        ) {
            MessageContents(isVisible, title, text, onConfirm)
        }
    }
}

@Composable
private fun MessageContents(
    isVisible: Boolean,
    title: String,
    text: String,
    onConfirm: () -> Unit,
) {
    val configuration = LocalConfiguration.current
    val screenHeight = configuration.screenHeightDp.dp

    Box(
        modifier = Modifier
            .widthIn(max = 400.dp)
            .fillMaxWidth()
            .heightIn(max = screenHeight * 0.8f)
            .clip(RoundedCornerShape(8.dp))
            .background(MenuBackground)
            .border(2.dp, Color.Gray, RoundedCornerShape(8.dp))
            .clickable(enabled = false) {}
    ) {
        Column(
            modifier = Modifier
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
                .clickable(enabled = false) {}
        ) {
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = title,
                style = DSTypography.title,
                color = Color.White
            )
            Spacer(modifier = Modifier.height(20.dp))
            Text(
                text = text,
                style = DSTypography.text,
                color = Color.White
            )
            Spacer(modifier = Modifier.height(32.dp))

            Text(
                text = stringResource(R.string.ok_action),
                style = DSTypography.menuOption,
                modifier = Modifier
                    .height(36.dp)
                    .fillMaxWidth()
                    .clickable { onConfirm() }
                    .padding(top = 8.dp)
            )
        }
    }
}

@Preview(showBackground = true, device = "spec:width=411dp,height=891dp,dpi=420,isRound=false,chinSize=0dp,orientation=landscape")
@Composable
fun MessageViewPreview() {
    MessageView(
        isVisible = true,
        title = "Some Title",
        text = "Some longer text.\nMight or might not go multiline...\nBut usually does",
        onCancel = {},
        onConfirm = {}
    )
}

class MessageViewModel(private val gameEngine: GameEngine) : ViewModel() {
    private val _isVisible = mutableStateOf<Boolean>(false)
    val isVisible: State<Boolean> = _isVisible

    private val _title = mutableStateOf<String>("")
    val title: State<String> = _title

    private val _text = mutableStateOf<String>("")
    val text: State<String> = _text

    init {
        viewModelScope.launch {
            gameEngine.gameState
                .map { it?.messages }
                .collect { message ->
                    _isVisible.value = message != null
                    _title.value = message?.title ?: ""
                    _text.value = message?.text ?: ""
                }
        }
    }

    fun cancel() {
        gameEngine.resumeGame()
        _isVisible.value = false
    }

    fun confirm() {
        gameEngine.resumeGame()
        _isVisible.value = false
    }
}

