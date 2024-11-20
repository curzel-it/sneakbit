package it.curzel.bitscape.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Color.Companion.Yellow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import it.curzel.bitscape.R

object DSTypography {
    val largeTitle = TextStyle(fontFamily = PixelOperator8, fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 36.sp)
    val title = TextStyle(fontFamily = PixelOperator8, fontWeight = FontWeight.Bold, fontSize = 16.sp, lineHeight = 24.sp)
    val text = TextStyle(fontFamily = PixelOperator8, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 24.sp)
    val caption = TextStyle(fontFamily = PixelOperator8, fontWeight = FontWeight.Normal, fontSize = 11.sp, lineHeight = 16.sp)
    val buttonCaption = TextStyle(fontFamily = PixelOperator8, fontWeight = FontWeight.Bold, fontSize = 14.sp, lineHeight = 16.sp)

    val menuOption = TextStyle(
        fontFamily = PixelOperator8,
        fontWeight = FontWeight.Bold,
        fontSize = 16.sp,
        color = Yellow,
    )

    val gameMenuOption = TextStyle(
        fontFamily = PixelOperator8,
        fontWeight = FontWeight.Bold,
        fontSize = 14.sp,
        color = Color.White.copy(alpha = 0.9f),
    )
}

private val PixelOperator8 = FontFamily(
    Font(R.font.pixeloperator8, FontWeight.Normal),
    Font(R.font.pixeloperator8, FontWeight.SemiBold),
    Font(R.font.pixeloperator8_bold, FontWeight.Bold),
    Font(R.font.pixeloperator8, FontWeight.Light)
)
