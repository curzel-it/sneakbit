package it.curzel.bitscape.rendering

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.play.core.review.ReviewManagerFactory
import it.curzel.bitscape.R
import it.curzel.bitscape.engine.GameEngine
import it.curzel.bitscape.gamecore.DisplayableMessage
import it.curzel.bitscape.ui.theme.DSTypography
import it.curzel.bitscape.ui.theme.MenuBackground
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

@Composable
fun MessageView(
    gameEngine: GameEngine,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val leaveAReviewText = stringResource(R.string.leave_a_review_in_game)
    val viewModel = remember { MessageViewModel(gameEngine, leaveAReviewText) }
    val isVisible by viewModel.isVisible
    val title by viewModel.title
    val text by viewModel.text
    val showStoreLink by viewModel.showStoreLink
    val showMaybeLater by viewModel.showMaybeLater
    val showOk by viewModel.showOk

    MessageView(
        isVisible = isVisible,
        title = title,
        text = text,
        showStoreLink,
        showMaybeLater,
        showOk,
        onCancel = { viewModel.cancel() },
        onStore = { viewModel.leaveReviewAndConfirm(context) },
        onConfirm = { viewModel.confirm() },
        modifier = modifier
    )
}

@Composable
private fun MessageView(
    isVisible: Boolean,
    title: String,
    text: String,
    showStoreLink: Boolean,
    showMaybeLater: Boolean,
    showOk: Boolean,
    onCancel: () -> Unit,
    onStore: () -> Unit,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(
        visible = isVisible,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = modifier.fillMaxSize()
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
            MessageContents(
                showStoreLink,
                showMaybeLater,
                showOk,
                title,
                text,
                onStore,
                onConfirm
            )
        }
    }
}

@Composable
private fun MessageContents(
    showStoreLink: Boolean,
    showMaybeLater: Boolean,
    showOk: Boolean,
    title: String,
    text: String,
    onStore: () -> Unit,
    onConfirm: () -> Unit,
) {
    val configuration = LocalConfiguration.current
    val screenHeight = configuration.screenHeightDp.dp

    Box(
        modifier = Modifier
            .widthIn(max = 400.dp)
            .fillMaxWidth()
            .heightIn(max = screenHeight * 0.8f)
            .clip(RoundedCornerShape(8.dp))
            .background(MenuBackground)
            .border(2.dp, Color.Gray, RoundedCornerShape(8.dp))
            .clickable(enabled = false) {}
    ) {
        Column(
            modifier = Modifier
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
                .clickable(enabled = false) {}
        ) {
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = title,
                style = DSTypography.title,
                color = Color.White
            )
            Spacer(modifier = Modifier.height(20.dp))
            Text(
                text = text,
                style = DSTypography.text,
                color = Color.White
            )
            Spacer(modifier = Modifier.height(32.dp))

            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.padding(top = 8.dp)
            ) {
                if (showStoreLink) {
                    Text(
                        text = stringResource(R.string.ok_action),
                        style = DSTypography.menuOption,
                        modifier = Modifier
                            .height(36.dp)
                            .fillMaxWidth()
                            .clickable { onStore() }
                    )
                }
                if (showMaybeLater) {
                    Text(
                        text = stringResource(R.string.maybe_later),
                        style = DSTypography.menuOption,
                        modifier = Modifier
                            .height(36.dp)
                            .fillMaxWidth()
                            .clickable { onConfirm() }
                    )
                }
                if (showOk) {
                    Text(
                        text = stringResource(R.string.ok_action),
                        style = DSTypography.menuOption,
                        modifier = Modifier
                            .height(36.dp)
                            .fillMaxWidth()
                            .clickable { onConfirm() }
                    )
                }
            }
        }
    }
}

class MessageViewModel(
    private val gameEngine: GameEngine,
    private val leaveAReviewText: String
) : ViewModel() {
    private val _isVisible = mutableStateOf<Boolean>(false)
    val isVisible: State<Boolean> = _isVisible

    private val _title = mutableStateOf<String>("")
    val title: State<String> = _title

    private val _text = mutableStateOf<String>("")
    val text: State<String> = _text

    private val _showOk = mutableStateOf<Boolean>(false)
    val showOk: State<Boolean> = _showOk

    private val _showStoreLink = mutableStateOf<Boolean>(false)
    val showStoreLink: State<Boolean> = _showStoreLink

    private val _showMaybeLater = mutableStateOf<Boolean>(false)
    val showMaybeLater: State<Boolean> = _showMaybeLater

    init {
        viewModelScope.launch {
            gameEngine.gameState
                .map { it?.messages }
                .collect { apply(it) }
        }
    }

    private fun apply(message: DisplayableMessage?) {
        if (message != null) {
            if (message.text == "leaveareview") {
                _isVisible.value = true
                _title.value = message.title
                _text.value = leaveAReviewText
                _showOk.value = false
                _showStoreLink.value = true
                _showMaybeLater.value = true
            } else {
                _isVisible.value = true
                _title.value = message.title
                _text.value = message.text
                _showOk.value = true
                _showStoreLink.value = false
                _showMaybeLater.value = false
            }
        } else {
            _isVisible.value = false
            _title.value = ""
            _text.value = ""
            _showOk.value = true
            _showStoreLink.value = false
            _showMaybeLater.value = false
        }
    }

    fun leaveReviewAndConfirm(context: Context) {
        val reviewManager = ReviewManagerFactory.create(context)
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val reviewInfo = reviewManager.requestReviewFlow().await()
                val activity = context as? Activity

                if (activity != null) {
                    reviewManager.launchReviewFlow(activity, reviewInfo).await()
                } else {
                    openStorePageViaLink(context)
                }
            } catch (e: Exception) {
                openStorePageViaLink(context)
                e.printStackTrace()
            } finally {
                gameEngine.resumeGame()
                _isVisible.value = false
            }
        }
    }

    private fun openStorePageViaLink(context: Context) {
        val storeLink = "https://play.google.com/store/apps/details?id=it.curzel.bitscape"
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(storeLink))
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        context.startActivity(intent)
    }

    fun cancel() {
        gameEngine.resumeGame()
        _isVisible.value = false
    }

    fun confirm() {
        gameEngine.resumeGame()
        _isVisible.value = false
    }
}

@Preview(showBackground = true, device = "spec:width=411dp,height=891dp,dpi=420,isRound=false,chinSize=0dp,orientation=landscape")
@Composable
fun MessageViewPreview() {
    MessageView(
        isVisible = true,
        title = "Some Title",
        text = "Some longer text.\nMight or might not go multiline...\nBut usually does",
        showStoreLink = false,
        showMaybeLater = false,
        showOk = true,
        onStore = {},
        onCancel = {},
        onConfirm = {}
    )
}

@Preview(showBackground = true, device = "spec:width=411dp,height=891dp,dpi=420,isRound=false,chinSize=0dp,orientation=landscape")
@Composable
fun MessageViewLeaveReviewPreview() {
    MessageView(
        isVisible = true,
        title = "Some Title",
        text = "Some longer text.\nMight or might not go multiline...\nBut usually does",
        showStoreLink = true,
        showMaybeLater = true,
        showOk = false,
        onStore = {},
        onCancel = {},
        onConfirm = {}
    )
}

