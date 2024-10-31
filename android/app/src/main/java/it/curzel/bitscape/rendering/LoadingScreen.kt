package it.curzel.bitscape.rendering

import androidx.compose.animation.AnimatedVisibility
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.State
import it.curzel.bitscape.engine.SomeGameEngine
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
            message = "",
            showsActivityIndicator = false
        )
    }
}

@Composable
fun LoadingScreen(
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel: LoadingScreenViewModel = remember { LoadingScreenViewModel(gameEngine) }
    val isVisible by viewModel.isVisible
    val text by viewModel.text
    val showsActivityIndicator by viewModel.showsActivityIndicator

    LoadingScreen(isVisible, text, showsActivityIndicator, modifier)
}

@Composable
private fun LoadingScreen(
    isVisible: Boolean,
    text: String,
    showsActivityIndicator: Boolean,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(
    visible = isVisible,
    enter = fadeIn(),
    exit = fadeOut(),
    modifier = modifier
        .fillMaxSize()
        .background(Color.Black.copy(alpha = 0.7f))
) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = modifier
                .fillMaxSize()
                .background(Color.Black)
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
    private val _isVisible = mutableStateOf(false)
    val isVisible: State<Boolean> = _isVisible

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
            _isVisible.value = config.isVisible
            _text.value = config.message
            _showsActivityIndicator.value = config.showsActivityIndicator
        }
    }
}

@Preview(showBackground = true)
@Composable
fun LoadingScreenPreview() {
    LoadingScreen(true, "Example", true, Modifier)
}