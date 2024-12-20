package it.curzel.bitscape.rendering

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.launch

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
    gameEngine: GameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel: LoadingScreenViewModel = remember { LoadingScreenViewModel(gameEngine) }
    val isVisible by viewModel.isVisible
    LoadingScreen(isVisible, modifier)
}

@Composable
private fun LoadingScreen(
    isVisible: Boolean,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(
        visible = isVisible,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = modifier.fillMaxSize()
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = modifier.fillMaxSize().background(Color.Black)
        ) {}
    }
}

class LoadingScreenViewModel(private val gameEngine: GameEngine) : ViewModel() {
    private val _isVisible = mutableStateOf(false)
    val isVisible: State<Boolean> = _isVisible

    init {
        viewModelScope.launch {
            gameEngine.isLoading.collect { isLoading ->
                apply(isLoading)
            }
        }
    }

    private fun apply(isLoading: Boolean) {
        viewModelScope.launch {
            _isVisible.value = isLoading
        }
    }
}

@Preview(showBackground = true)
@Composable
fun LoadingScreenPreview() {
    LoadingScreen(true, Modifier)
}