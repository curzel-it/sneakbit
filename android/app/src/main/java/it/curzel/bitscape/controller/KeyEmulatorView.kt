package it.curzel.bitscape.controller

import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.painterResource
import it.curzel.bitscape.engine.GameEngine

@Composable
fun KeyEmulatorView(
    key: EmulatedKey,
    gameEngine: GameEngine
) {
    var isBeingPressed by remember { mutableStateOf(false) }
    val resourceId = if (isBeingPressed) key.imageKeyDown else key.imageKeyUp

    Image(
        painter = painterResource(id = resourceId),
        contentDescription = null,
        contentScale = ContentScale.None,
        modifier = Modifier
            .size(56.dp)
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
