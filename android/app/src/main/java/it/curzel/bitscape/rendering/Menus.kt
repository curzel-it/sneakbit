
package it.curzel.bitscape.rendering
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.engine.SomeGameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.launch

data class MenuConfig(
    val isVisible: Boolean,
    val title: String?,
    val text: String?,
    val options: List<String>
) {
    companion object {
        val none = MenuConfig(
            isVisible = false,
            title = "",
            text = "",
            options = listOf("Ok")
        )

        val demo = MenuConfig(
            isVisible = true,
            title = "Hello Title",
            text = "Hello text 1\nHello text 2\nHello text 3",
            options = listOf("Ok", "Not Ok")
        )
    }
}

@Composable
fun MenuView(
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { MenuViewModel(gameEngine) }
    val menuConfig by viewModel.menuConfig

    MenuView(
        menuConfig = menuConfig,
        onCancel = { viewModel.cancel() },
        onSelection = { viewModel.selectOption(it) },
        modifier = modifier
    )
}

@Composable
private fun MenuView(
    menuConfig: MenuConfig?,
    onCancel: () -> Unit,
    onSelection: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(
        visible = menuConfig != null,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = modifier.fillMaxSize()
    ) {
        menuConfig?.let {
            MenuView(it, onCancel, onSelection)
        }
    }
}

@Composable
private fun MenuView(
    menuConfig: MenuConfig,
    onCancel: () -> Unit,
    onSelection: (Int) -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
            .padding(24.dp)
            .padding(bottom = 24.dp)
            .clickable { onCancel() },
        contentAlignment = Alignment.Center
    ) {
        Column {
            Spacer(modifier = Modifier.weight(1.0f))
            MenuContent(menuConfig, onSelection)
        }
    }
}

@Composable
private fun MenuContent(
    menuConfig: MenuConfig,
    onSelection: (Int) -> Unit,
) {
    Box(
        modifier = Modifier
            // .padding(16.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color.Black)
            .border(2.dp, Color.Gray, RoundedCornerShape(8.dp))
            .shadow(4.dp, RoundedCornerShape(8.dp))
            .clickable(enabled = false) {}
    ) {
        Column(
            modifier = Modifier
                .padding(16.dp)
                .widthIn(max = 400.dp)
                .clickable(enabled = false) {}
        ) {
            Spacer(modifier = Modifier.height(6.dp))

            menuConfig.title?.let { title ->
                Text(
                    text = title,
                    style = DSTypography.title,
                    color = Color.White,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            menuConfig.text?.let { text ->
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = text,
                    style = DSTypography.text,
                    color = Color.White,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            Spacer(modifier = Modifier.height(32.dp))

            menuConfig.options.forEachIndexed { index, option ->
                Text(
                    text = "> $option",
                    style = DSTypography.menuOption,
                    modifier = Modifier
                        .height(36.dp)
                        .fillMaxWidth()
                        .clickable { onSelection(index) }
                )
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
fun MenuViewPreview() {
    MenuView(
        menuConfig = MenuConfig.demo,
        onCancel = {},
        onSelection = {}
    )
}

class MenuViewModel(private val gameEngine: SomeGameEngine) : ViewModel() {
    private val _menuConfig = mutableStateOf<MenuConfig?>(null)
    val menuConfig: State<MenuConfig?> = _menuConfig

    init {
        viewModelScope.launch {
            gameEngine.menuConfig().collect { config ->
                if (config.isVisible) {
                    _menuConfig.value = config
                } else {
                    _menuConfig.value = null
                }
            }
        }
    }

    fun cancel() {
        gameEngine.setKeyDown(EmulatedKey.ESCAPE)
    }

    fun selectOption(index: Int) {
        gameEngine.onMenuItemSelection(index)
    }
}

