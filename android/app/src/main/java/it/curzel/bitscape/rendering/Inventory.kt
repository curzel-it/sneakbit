package it.curzel.bitscape.rendering

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.R
import it.curzel.bitscape.engine.MockGameEngine
import it.curzel.bitscape.engine.SomeGameEngine
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.launch

@Composable
fun InventoryView(
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    val viewModel = remember { InventoryViewModel(gameEngine) }
    val numberOfKunais = viewModel.numberOfKunais.value

    Box(
        contentAlignment = Alignment.TopEnd,
        modifier = modifier
            .fillMaxSize()
            .padding(
                WindowInsets.safeDrawing.asPaddingValues()
            )
    ) {
        NumberOfKunaisView(numberOfKunais = numberOfKunais)
    }
}

class InventoryViewModel(private val gameEngine: SomeGameEngine) : ViewModel() {
    private val _numberOfKunais = mutableStateOf(0)
    val numberOfKunais: State<Int> = _numberOfKunais

    init {
        viewModelScope.launch {
            gameEngine.numberOfKunais()
                .collect { count ->
                    _numberOfKunais.value = count
                }
        }
    }
}

@Composable
fun NumberOfKunaisView(numberOfKunais: Int) {
    if (numberOfKunais > 0) {
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(0.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            Image(
                bitmap = ImageBitmap.imageResource(R.drawable.inventory_icon_kunai),
                contentDescription = "Kunai Icon",
                modifier = Modifier.size(24.dp),
                contentScale = ContentScale.FillBounds,
                filterQuality = FilterQuality.None
            )
            if (numberOfKunais > 1) {
                Text(
                    text = "x$numberOfKunais",
                    style = DSTypography.highlightedCaption
                )
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
fun InventoryViewPreview() {
    InventoryView(gameEngine = MockGameEngine())
}