package it.curzel.bitscape.rendering

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
import it.curzel.bitscape.gamecore.IntRect
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.ui.theme.DSTypography
import kotlinx.coroutines.launch

data class ToastConfig(
    val backgroundColorArgb: Long,
    val opacity: Float,
    val text: String,
    val isHint: Boolean,
    val spriteSheetId: Int?,
    val textureFrame: IntRect?
) {
    companion object {
        val none = ToastConfig(
            backgroundColorArgb = 0x00000000,
            opacity = 0.0f,
            text = "",
            isHint = false,
            spriteSheetId = NativeLib.SPRITE_SHEET_BLANK.toInt(),
            textureFrame = IntRect(0, 0, 1, 1)
        )

        val demo = ToastConfig(
            backgroundColorArgb = 0xFF000000,
            opacity = 1.0f,
            text = "Hello world!",
            isHint = true,
            spriteSheetId = NativeLib.SPRITE_SHEET_INVENTORY.toInt(),
            textureFrame = IntRect(3, 3, 1, 1)
        )
    }
}

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
    val opacity by viewModel.opacity
    val image by viewModel.image

    ToastView(
        isVisible = isVisible,
        alignment = alignment,
        text = text,
        borderColor = borderColor,
        backgroundColor = backgroundColor,
        opacity = opacity,
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
    opacity: Float,
    image: ImageBitmap?
) {
    if (isVisible) {
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
                    .alpha(opacity)
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

    private val _opacity = mutableFloatStateOf(0f)
    val opacity: State<Float> = _opacity

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
            gameEngine.toastConfig().collect { toast ->
                loadToast(toast)
            }
        }
    }

    private fun loadToast(toast: ToastConfig) {
        _backgroundColor.value = Color(toast.backgroundColorArgb).copy(alpha = 1.0f)
        _opacity.floatValue = toast.opacity
        _text.value = toast.text.ifEmpty { "..." }
        _isVisible.value = _opacity.floatValue > 0.05f
        _alignment.value = if (toast.isHint) Alignment.TopStart else Alignment.TopEnd
        _borderColor.value = if (toast.isHint) Color.Yellow else Color.Cyan

        toast.spriteSheetId?.let { spriteSheetId ->
            toast.textureFrame?.let { textureRect ->
                val bitmap = spritesProvider.bitmapFor(spriteSheetId.toUInt(), textureRect)
                _image.value = bitmap?.asImageBitmap()
            }
        } ?: run {
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
        opacity = 1.0f,
        image = ImageBitmap.imageResource(R.drawable.confirm_button_up),
    )
}
