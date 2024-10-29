package it.curzel.bitscape.designsystem

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import it.curzel.bitscape.R

object Typography {
    val largeTitle = TextStyle(fontFamily = PixelOperator8, fontWeight = FontWeight.Bold, fontSize = 24.sp)
    val title = TextStyle(fontFamily = PixelOperator8, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    val text = TextStyle(fontFamily = PixelOperator8, fontWeight = FontWeight.Normal, fontSize = 14.sp)
    val menuOption = TextStyle(fontFamily = PixelOperator8, fontWeight = FontWeight.Normal, fontSize = 16.sp)
    val caption = TextStyle(fontFamily = PixelOperator8, fontWeight = FontWeight.Normal, fontSize = 11.sp)
}

private val PixelOperator8 = FontFamily(
    Font(R.font.pixeloperator8, FontWeight.Normal),
    Font(R.font.pixeloperator8, FontWeight.SemiBold),
    Font(R.font.pixeloperator8_bold, FontWeight.Bold),
    Font(R.font.pixeloperator8, FontWeight.Light)
)
