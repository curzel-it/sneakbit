package it.curzel.bitscape.engine

import android.content.Context
import android.content.res.Configuration
import android.util.DisplayMetrics

class RenderingScaleUseCase(private val context: Context) {
    fun current(): Float {
        return when {
            isTablet() -> 3.0f
            currentDisplayScale() > 1f -> 2.0f
            else -> 1.0f
        }
    }

    private fun isTablet(): Boolean {
        val screenLayout = context.resources.configuration.screenLayout
        val screenSize = screenLayout and Configuration.SCREENLAYOUT_SIZE_MASK
        return screenSize >= Configuration.SCREENLAYOUT_SIZE_LARGE
    }

    private fun currentDisplayScale(): Float {
        val metrics: DisplayMetrics = context.resources.displayMetrics
        return metrics.density
    }
}
