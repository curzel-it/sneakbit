package it.curzel.bitscape.controller

import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import it.curzel.bitscape.engine.MockGameEngine
import it.curzel.bitscape.engine.SomeGameEngine

@Composable
fun KeyEmulatorView(
    key: EmulatedKey,
    gameEngine: SomeGameEngine,
    modifier: Modifier = Modifier
) {
    var isBeingPressed by remember { mutableStateOf(false) }
    val resourceId = if (isBeingPressed) key.imageKeyDown else key.imageKeyUp

    Image(
        bitmap = ImageBitmap.imageResource(resourceId),
        contentDescription = null,
        contentScale = ContentScale.FillBounds,
        filterQuality = FilterQuality.None,
        modifier = modifier
            .size(90.dp)
            .padding(15.dp)
            .pointerInput(key) {
                detectTapGestures(
                    onPress = {
                        isBeingPressed = true
                        gameEngine.setKeyDown(key)
                        try {
                            awaitRelease()
                        } finally {
                            isBeingPressed = false
                            gameEngine.setKeyUp(key)
                        }
                    }
                )
            }
    )
}

@Preview(showBackground = true)
@Composable
fun KeyEmulatorViewPreview() {
    KeyEmulatorView(key = EmulatedKey.CONFIRM, gameEngine = MockGameEngine())
}