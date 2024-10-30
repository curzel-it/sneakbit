package it.curzel.bitscape.engine

import android.content.Context
import android.content.res.Configuration
import android.util.DisplayMetrics

class RenderingScaleUseCase(private val context: Context) {
    fun current(): Float {
        val inc = if (isTablet()) { 3 } else { 2 }
        return inc + currentDisplayScale()
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
