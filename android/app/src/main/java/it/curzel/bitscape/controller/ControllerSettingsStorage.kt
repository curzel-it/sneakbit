package it.curzel.bitscape.controller

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.max
import androidx.compose.ui.unit.min

class ControllerSettingsStorage(
    context: Context,
    screenWidthDp: Dp,
    screenHeightDp: Dp,
    density: Density
) {
    private val sharedPreferences: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private companion object {
        const val PREFS_NAME = "ControllerSettingsPrefs"
        const val KEY_DID_SET_DEFAULTS = "kControllerOffsetDidSetDefaults"
        const val KEY_PORTRAIT_X = "kControllerOffsetPortraitX"
        const val KEY_PORTRAIT_Y = "kControllerOffsetPortraitY"
        const val KEY_LANDSCAPE_X = "kControllerOffsetLandscapeX"
        const val KEY_LANDSCAPE_Y = "kControllerOffsetLandscapeY"
        const val KEY_UNKNOWN = "kControllerOffsetUnknown"
    }

    init {
        if (!didSetDefaults()) {
            loadDefaults(screenWidthDp, screenHeightDp, density)
            setDefaultsLoaded()
        }
    }

    fun store(offset: Float, axis: ControllerOffsetAxis, orientation: ControllerOrientation) {
        val key = getKey(axis, orientation)
        sharedPreferences.edit().putFloat(key, offset).apply()
    }

    fun offset(axis: ControllerOffsetAxis, orientation: ControllerOrientation): Float {
        val key = getKey(axis, orientation)
        return sharedPreferences.getFloat(key, 0f)
    }

    private fun getKey(axis: ControllerOffsetAxis, orientation: ControllerOrientation): String {
        return when (axis to orientation) {
            ControllerOffsetAxis.X to ControllerOrientation.PORTRAIT -> KEY_PORTRAIT_X
            ControllerOffsetAxis.Y to ControllerOrientation.PORTRAIT -> KEY_PORTRAIT_Y
            ControllerOffsetAxis.X to ControllerOrientation.LANDSCAPE -> KEY_LANDSCAPE_X
            ControllerOffsetAxis.Y to ControllerOrientation.LANDSCAPE -> KEY_LANDSCAPE_Y
            else -> KEY_UNKNOWN
        }
    }

    private fun didSetDefaults(): Boolean {
        return sharedPreferences.getBoolean(KEY_DID_SET_DEFAULTS, false)
    }

    private fun setDefaultsLoaded() {
        sharedPreferences.edit().putBoolean(KEY_DID_SET_DEFAULTS, true).apply()
    }

    private fun loadDefaults(screenWidth: Dp, screenHeight: Dp, density: Density) {
        val width = min(screenWidth, screenHeight)
        val height = max(screenWidth, screenHeight)

        val portraitX = width - keyEmulatorViewSize * 1.0f - 20.dp
        val portraitY = height - keyEmulatorViewSize - 90.dp

        val landscapeX = height - keyEmulatorViewSize - 70.dp
        val landscapeY = width - keyEmulatorViewSize - 70.dp

        store(portraitX.value * density.density, ControllerOffsetAxis.X, ControllerOrientation.PORTRAIT)
        store(portraitY.value * density.density, ControllerOffsetAxis.Y, ControllerOrientation.PORTRAIT)
        store(landscapeX.value * density.density, ControllerOffsetAxis.X, ControllerOrientation.LANDSCAPE)
        store(landscapeY.value * density.density, ControllerOffsetAxis.Y, ControllerOrientation.LANDSCAPE)
    }
}

enum class ControllerOrientation {
    PORTRAIT,
    LANDSCAPE
}

enum class ControllerOffsetAxis {
    X,
    Y
}