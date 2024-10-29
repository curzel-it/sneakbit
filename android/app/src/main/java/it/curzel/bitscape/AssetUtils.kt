package it.curzel.bitscape

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

object AssetUtils {

    @Throws(IOException::class)
    fun copyAssetFolder(context: Context, assetFolderName: String, destFolder: File) {
        val assetManager = context.assets
        val files = assetManager.list(assetFolderName) ?: throw IOException("Asset folder not found: $assetFolderName")
        if (files.isEmpty()) {
            // It's a file
            assetManager.open(assetFolderName).use { inputStream ->
                FileOutputStream(destFolder).use { outputStream ->
                    inputStream.copyTo(outputStream)
                }
            }
        } else {
            // It's a folder
            if (!destFolder.exists()) {
                destFolder.mkdirs()
            }
            for (file in files) {
                copyAssetFolder(context, "$assetFolderName/$file", File(destFolder, file))
            }
        }
    }

    fun extractAssetFolder(context: Context, assetFolderName: String, destFolderName: String): String {
        val destPath = File(context.filesDir, destFolderName)
        if (!destPath.exists()) {
            copyAssetFolder(context, assetFolderName, destPath)
        }
        return destPath.absolutePath
    }
}
