package it.curzel.bitscape.gameui

import android.annotation.SuppressLint
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

@Composable
fun HpView(gameEngine: GameEngine) {
    val viewModel: HpViewModel = remember {
        HpViewModel(gameEngine)
    }
    val isVisible by viewModel.isVisible
    val text by viewModel.text
    val textColor by viewModel.textColor
    val style by viewModel.textStyle

    HpView(
        isVisible = isVisible,
        text = text,
        textColor = textColor,
        style = style,
    )
}

@Composable
private fun HpView(
    isVisible: Boolean,
    text: String,
    textColor: Color,
    style: TextStyle
) {
    if (isVisible) {
        Box(
            contentAlignment = Alignment.BottomCenter,
            modifier = Modifier.fillMaxHeight()
        ) {
            Text(
                text = text,
                style = style,
                color = textColor,
                textAlign = TextAlign.Center
            )
        }
    }
}

class HpViewModel(private val gameEngine: GameEngine) : ViewModel() {
    private val _isVisible = mutableStateOf(false)
    val isVisible: State<Boolean> = _isVisible

    private val _text = mutableStateOf("")
    val text: State<String> = _text

    private val _textColor = mutableStateOf(Color.White)
    val textColor: State<Color> = _textColor

    private val _textStyle = mutableStateOf(DSTypography.text)
    val textStyle: State<TextStyle> = _textStyle

    init {
        viewModelScope.launch {
            gameEngine.gameState
                .filterNotNull()
                .collect { gameState ->
                    handle(gameState.isGameOver(), gameState.hp)
                }
        }
    }

    @SuppressLint("DefaultLocale")
    private fun handle(gameOver: Boolean, hp: Float) {
        val maxHpToShow = if (gameOver) { -99.0f } else { 60.0f }

        if (hp < maxHpToShow) {
            _isVisible.value = true
            _text.value = "HP ${String.format("%.1f", hp)}%"

            if (hp < 30.0) {
                _textColor.value = Color.Red
                _textStyle.value = DSTypography.menuOption
            } else {
                _textColor.value = Color.White
                _textStyle.value = DSTypography.text
            }
        } else {
            _isVisible.value = false
            _text.value = ""
            _textColor.value = Color.White
            _textStyle.value = DSTypography.text
        }
    }
}

@Preview(showBackground = true)
@Composable
fun HpViewPreview() {
    HpView(
        isVisible = true,
        text = "HP 69.0%",
        textColor = Color.Red,
        style = DSTypography.menuOption
    )
}