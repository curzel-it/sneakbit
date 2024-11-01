package it.curzel.bitscape

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

object AssetUtils {
    fun extractAssetFolder(context: Context, assetFolderName: String, destFolderName: String): String {
        val destPath = File(context.filesDir, destFolderName)
        if (destPath.exists()) {
            destPath.delete()
        }
        copyAssetFolder(context, assetFolderName, destPath)
        return destPath.absolutePath
    }

    @Throws(IOException::class)
    private fun copyAssetFolder(context: Context, assetFolderName: String, destFolder: File) {
        val assetManager = context.assets
        val files = assetManager.list(assetFolderName) ?: throw IOException("Asset folder not found: $assetFolderName")
        if (files.isEmpty()) {
            assetManager.open(assetFolderName).use { inputStream ->
                FileOutputStream(destFolder).use { outputStream ->
                    inputStream.copyTo(outputStream)
                }
            }
        } else {
            if (!destFolder.exists()) {
                destFolder.mkdirs()
            }
            for (file in files) {
                copyAssetFolder(context, "$assetFolderName/$file", File(destFolder, file))
            }
        }
    }
}
