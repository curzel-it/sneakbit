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
import androidx.compose.ui.platform.LocalContext
import it.curzel.bitscape.engine.GameEngine

// Composable function for KeyEmulatorView
@Composable
fun KeyEmulatorView(
    key: EmulatedKey,
    gameEngine: GameEngine
) {
    var isBeingPressed by remember { mutableStateOf(false) }
    val resourceId = if (isBeingPressed) key.imageKeyDown else key.imageKeyUp
    val context = LocalContext.current

    // Image composable representing the key
    Image(
        painter = painterResource(id = resourceId),
        contentDescription = null, // Provide a description if accessibility is needed
        contentScale = ContentScale.None,
        modifier = Modifier
            .size(56.dp) // Equivalent to CGSize(width: 56, height: 56)
            .pointerInput(key) {
                detectTapGestures(
                    onPress = {
                        // When the user starts pressing
                        isBeingPressed = true
                        gameEngine.setKeyDown(key)
                        try {
                            // Await the release or cancellation of the press
                            awaitRelease()
                        } finally {
                            // When the press is released or canceled
                            isBeingPressed = false
                            gameEngine.setKeyUp(key)
                        }
                    }
                )
            }
    )
}
