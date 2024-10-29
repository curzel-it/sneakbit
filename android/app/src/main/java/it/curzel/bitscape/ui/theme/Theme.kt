package it.curzel.bitscape.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme = darkColorScheme(
    primary = Purple80,
    secondary = PurpleGrey80,
    tertiary = Pink80
)

private val LightColorScheme = lightColorScheme(
    primary = Purple40,
    secondary = PurpleGrey40,
    tertiary = Pink40
)

@Composable
fun SneakBitTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }

        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = androidx.compose.material3.Typography(
            displayLarge = it.curzel.bitscape.ui.theme.Typography.largeTitle,
            displayMedium = it.curzel.bitscape.ui.theme.Typography.largeTitle,
            displaySmall = it.curzel.bitscape.ui.theme.Typography.largeTitle,
            headlineLarge = it.curzel.bitscape.ui.theme.Typography.title,
            headlineMedium = it.curzel.bitscape.ui.theme.Typography.title,
            headlineSmall = it.curzel.bitscape.ui.theme.Typography.title,
            titleLarge = it.curzel.bitscape.ui.theme.Typography.title,
            titleMedium = it.curzel.bitscape.ui.theme.Typography.title,
            titleSmall = it.curzel.bitscape.ui.theme.Typography.title,
            bodyLarge = it.curzel.bitscape.ui.theme.Typography.text,
            bodyMedium = it.curzel.bitscape.ui.theme.Typography.text,
            bodySmall = it.curzel.bitscape.ui.theme.Typography.text,
            labelLarge = it.curzel.bitscape.ui.theme.Typography.text,
            labelMedium = it.curzel.bitscape.ui.theme.Typography.text,
            labelSmall = it.curzel.bitscape.ui.theme.Typography.caption
        ),
        content = content
    )
}