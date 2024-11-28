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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.controller.EmulatedKey
import it.curzel.bitscape.engine.GameEngine
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
    gameEngine: GameEngine,
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
        contentAlignment = Alignment.BottomCenter
    ) {
        MenuContent(menuConfig, onSelection)
    }
}

@Composable
private fun MenuContent(
    menuConfig: MenuConfig,
    onSelection: (Int) -> Unit,
) {
    val configuration = LocalConfiguration.current
    val screenHeight = configuration.screenHeightDp.dp

    Box(
        modifier = Modifier
            .widthIn(max = 400.dp)
            .fillMaxWidth()
            .heightIn(max = screenHeight * 0.8f)
            .clip(RoundedCornerShape(8.dp))
            .background(Color.Black)
            .border(2.dp, Color.Gray, RoundedCornerShape(8.dp))
            .shadow(4.dp, RoundedCornerShape(8.dp))
            .clickable(enabled = false) {}
    ) {
        Column(
            modifier = Modifier
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
                .clickable(enabled = false) {}
        ) {
            Spacer(modifier = Modifier.height(6.dp))

            menuConfig.title?.let { title ->
                Text(
                    text = title,
                    style = DSTypography.title,
                    color = Color.White
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            menuConfig.text?.let { text ->
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = text,
                    style = DSTypography.text,
                    color = Color.White
                )
            }

            Spacer(modifier = Modifier.height(32.dp))

            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                menuConfig.options.forEachIndexed { index, option ->
                    Text(
                        text = option,
                        style = DSTypography.menuOption,
                        modifier = Modifier
                            .height(36.dp)
                            .fillMaxWidth()
                            .clickable { onSelection(index) }
                            .padding(top = 8.dp)
                    )
                }
            }
        }
    }
}

@Preview(showBackground = true, device = "spec:width=411dp,height=891dp,dpi=420,isRound=false,chinSize=0dp,orientation=landscape")
@Composable
fun MenuViewPreview() {
    MenuView(
        menuConfig = MenuConfig.demo,
        onCancel = {},
        onSelection = {}
    )
}

class MenuViewModel(private val gameEngine: GameEngine) : ViewModel() {
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
