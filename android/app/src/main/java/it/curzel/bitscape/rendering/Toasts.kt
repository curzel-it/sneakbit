package it.curzel.bitscape.rendering

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.R
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.gamecore.DisplayableToast
import it.curzel.bitscape.gamecore.IntRect
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.ui.theme.DSTypography
import it.curzel.bitscape.ui.theme.ToastBackground
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch

@Composable
fun ToastView(
    gameEngine: GameEngine,
    spritesProvider: SpritesProvider
) {
    val viewModel: ToastViewModel = remember {
        ToastViewModel(gameEngine, spritesProvider)
    }
    val isVisible by viewModel.isVisible
    val alignment by viewModel.alignment
    val text by viewModel.text
    val borderColor by viewModel.borderColor
    val backgroundColor by viewModel.backgroundColor
    val image by viewModel.image

    ToastView(
        isVisible = isVisible,
        alignment = alignment,
        text = text,
        borderColor = borderColor,
        backgroundColor = backgroundColor,
        image = image,
    )
}

@Composable
private fun ToastView(
    isVisible: Boolean,
    alignment: Alignment,
    text: String,
    borderColor: Color,
    backgroundColor: Color,
    image: ImageBitmap?
) {
    AnimatedVisibility(
        visible = isVisible,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = Modifier.fillMaxSize()
    ) {
        Box(
            contentAlignment = alignment,
            modifier = Modifier.fillMaxSize()
                .padding(horizontal = 16.dp)
                .padding(top = 32.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(0.dp),
                modifier = Modifier
                    .widthIn(max = 400.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(backgroundColor)
                    .border(2.dp, borderColor, RoundedCornerShape(4.dp))
                    .shadow(6.dp, RoundedCornerShape(4.dp))
            ) {
                image?.let { imageBitmap ->
                    Image(
                        bitmap = imageBitmap,
                        contentDescription = null,
                        contentScale = ContentScale.FillBounds,
                        filterQuality = FilterQuality.None,
                        modifier = Modifier
                            .padding(vertical = 12.dp)
                            .padding(start = 12.dp)
                            .size(32.dp)
                    )
                }
                Text(
                    modifier = Modifier
                        .padding(vertical = 16.dp)
                        .padding(horizontal = 12.dp),
                    text = text,
                    color = Color.White,
                    style = DSTypography.text
                )
            }
        }
    }
}

class ToastViewModel(
    private val gameEngine: GameEngine,
    private val spritesProvider: SpritesProvider
) : ViewModel() {
    private val _backgroundColor = mutableStateOf(Color.Black)
    val backgroundColor: State<Color> = _backgroundColor

    private val _borderColor = mutableStateOf(Color.Black)
    val borderColor: State<Color> = _borderColor

    private val _text = mutableStateOf("")
    val text: State<String> = _text

    private val _image = mutableStateOf<ImageBitmap?>(null)
    val image: State<ImageBitmap?> = _image

    private val _isVisible = mutableStateOf(false)
    val isVisible: State<Boolean> = _isVisible

    private val _alignment = mutableStateOf(Alignment.TopStart)
    val alignment: State<Alignment> = _alignment

    init {
        viewModelScope.launch {
            gameEngine.gameState
                .mapNotNull { it?.toasts }
                .collect { toast ->
                    apply(toast)
                }
        }
    }

    private fun apply(toast: DisplayableToast) {
        _backgroundColor.value = ToastBackground
        _text.value = toast.text.ifEmpty { "..." }
        _isVisible.value = true
        _alignment.value = if (toast.isHint()) Alignment.TopStart else Alignment.TopEnd
        _borderColor.value = if (toast.isHint()) Color.Yellow else Color.Cyan

        viewModelScope.launch {
            delay((1000 * toast.duration * 1.5).toLong())
            _isVisible.value = false
        }

        if (toast.image != null) {
            val bitmap = spritesProvider.bitmapFor(toast.image.spriteSheetId, toast.image.textureFrame)
            _image.value = bitmap?.asImageBitmap()
        } else {
            _image.value = null
        }
    }
}

@Preview(showBackground = true)
@Composable
fun ToastsViewPreview() {
    ToastView(
        isVisible = true,
        alignment = Alignment.TopEnd,
        text = "Hello World!",
        borderColor = Color.Red,
        backgroundColor = Color.Black,
        image = ImageBitmap.imageResource(R.drawable.confirm_button_up),
    )
}
