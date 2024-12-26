package it.curzel.bitscape.gameui

import android.annotation.SuppressLint
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import it.curzel.bitscape.R
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.gamecore.GameState
import it.curzel.bitscape.ui.theme.DSTypography
import it.curzel.bitscape.ui.theme.HighlightedText
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlin.math.ceil

@Composable
fun TurnInfoView(gameEngine: GameEngine) {
    val prepTextFormat = stringResource(R.string.prep_for_next_turn)
    val viewModel: TurnInfoViewModel = remember {
        TurnInfoViewModel(gameEngine, prepTextFormat)
    }
    val countdownText by viewModel.countdownText
    val prepText by viewModel.prepText

    TurnInfoView(
        countdownText = countdownText,
        prepText = prepText
    )
}

@Composable
fun TurnInfoView(
    countdownText: String,
    prepText: String
) {
    Box(modifier = Modifier.fillMaxSize()) {
        if (prepText.isNotBlank()) {
            Text(
                text = prepText,
                style = DSTypography.titleWithShadow,
                textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.Center)
            )
        }
        if (countdownText.isNotBlank()) {
            Text(
                text = countdownText,
                style = DSTypography.largeTitleWithShadow,
                textAlign = TextAlign.Start,
                color = HighlightedText,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(20.dp)
            )
        }
    }
}

class TurnInfoViewModel(
    private val gameEngine: GameEngine,
    private val prepTextFormat: String
) : ViewModel() {
    private val _countdownText = mutableStateOf("")
    val countdownText: State<String> = _countdownText

    private val _prepText = mutableStateOf("")
    val prepText: State<String> = _prepText

    init {
        viewModelScope.launch {
            gameEngine.gameState
                .filterNotNull()
                .map { TurnInfo.fromGameState(it) }
                .distinctUntilChanged()
                .collect {
                    _countdownText.value = it.countdownText()
                    _prepText.value = it.prepText(prepTextFormat)
                }
        }
    }
}

private data class TurnInfo(
    val playerIndex: Int,
    val isPvp: Boolean,
    val isTurnPrep: Boolean,
    val turnTimeLeft : Float
) {
    companion object {
        fun fromGameState(state: GameState): TurnInfo {
            return TurnInfo(
                state.currentPlayerIndex,
                state.isPvp,
                state.isTurnPrep,
                state.turnTimeLeft
            )
        }
    }

    fun prepText(prepTextFormat: String): String {
        return if (isPvp && isTurnPrep) {
            prepTextFormat
                .replace("%PLAYER_NAME%", "${playerIndex + 1}")
                .replace("%TIME%", "${ceil(turnTimeLeft).toInt()}")
        } else {
            ""
        }
    }

    @SuppressLint("DefaultLocale")
    fun countdownText(): String {
        return if (isPvp && !isTurnPrep) {
            String.format("%.1f\"", turnTimeLeft)
        } else {
            ""
        }
    }
}