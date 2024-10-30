package it.curzel.bitscape.rendering

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.State
import it.curzel.bitscape.engine.SomeGameEngine
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import it.curzel.bitscape.engine.MockGameEngine
import it.curzel.bitscape.ui.theme.DSTypography

data class LoadingScreenConfig(
    val isVisible: Boolean,
    val message: String,
    val showsActivityIndicator: Boolean
) {
    companion object {
        val none = LoadingScreenConfig(
            isVisible = false,
            message = "",
            showsActivityIndicator = false
        )

        val worldTransition = LoadingScreenConfig(
            isVisible = true,
            message = "Changing world",
            showsActivityIndicator = false
        )

        val gameSetup = LoadingScreenConfig(
            isVisible = true,
            message = "Applying updates...",
            showsActivityIndicator = true
        )
    }
}

@Composable
fun LoadingScreen(
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel: LoadingScreenViewModel = remember { LoadingScreenViewModel(gameEngine) }

    val animatedOpacity by animateFloatAsState(
        targetValue = viewModel.opacity.value,
        animationSpec = tween(durationMillis = 300)
    )

    val text by viewModel.text
    val showsActivityIndicator by viewModel.showsActivityIndicator

    LoadingScreen(animatedOpacity, text, showsActivityIndicator, modifier)
}

@Composable
private fun LoadingScreen(
    opacity: Float,
    text: String,
    showsActivityIndicator: Boolean,
    modifier: Modifier = Modifier
) {
    if (opacity > 0f) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = opacity))
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = text,
                    color = Color.White,
                    style = DSTypography.title
                )

                if (showsActivityIndicator) {
                    Spacer(modifier = Modifier.height(16.dp))
                    CircularProgressIndicator(color = Color.White)
                }
            }
        }
    }
}

class LoadingScreenViewModel(private val gameEngine: SomeGameEngine) : ViewModel() {
    private val _opacity = mutableStateOf(0f)
    val opacity: State<Float> = _opacity

    private val _text = mutableStateOf("")
    val text: State<String> = _text

    private val _showsActivityIndicator = mutableStateOf(false)
    val showsActivityIndicator: State<Boolean> = _showsActivityIndicator

    init {
        viewModelScope.launch {
            gameEngine.loadingScreenConfig().collect { config ->
                applyConfig(config)
            }
        }
    }

    private fun applyConfig(config: LoadingScreenConfig) {
        viewModelScope.launch {
            if (config.isVisible) {
                animateFloat(
                    from = _opacity.value,
                    to = 1f,
                    durationMillis = 300
                ) { value ->
                    _opacity.value = value
                }
            } else {
                animateFloat(
                    from = _opacity.value,
                    to = 0f,
                    durationMillis = 300
                ) { value ->
                    _opacity.value = value
                }
            }
            _text.value = config.message
            _showsActivityIndicator.value = config.showsActivityIndicator
        }
    }

    private suspend fun animateFloat(
        from: Float,
        to: Float,
        durationMillis: Int,
        onUpdate: (Float) -> Unit
    ) {
        androidx.compose.animation.core.Animatable(from).animateTo(
            targetValue = to,
            animationSpec = tween(durationMillis)
        ) {
            onUpdate(value)
        }
    }
}

@Preview(showBackground = true)
@Composable
fun LoadingScreenPreview() {
    LoadingScreen(1.0f, "Example", true, Modifier)
}