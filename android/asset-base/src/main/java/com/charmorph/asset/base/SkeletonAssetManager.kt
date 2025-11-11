package com.charmorph.asset.base

import android.content.Context
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream

/**
 * Downloads and extracts the canonical human skeleton STL bundle published by Artec3D.
 *
 * The asset is quite large, so it is fetched on demand and cached on disk. Callers should
 * invoke [ensureSkeletonPresent] from a background coroutine (dispatcher is configurable for tests).
 */
class SkeletonAssetManager(
    private val context: Context,
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    companion object {
        private const val SKELETON_URL =
            "https://cdn.artec3d.com/content-hub-3dmodels/human-skeleton-stl.zip?VersionId=6XL1Suao03kp08Jncrb5scelCpWG12rb"
        private const val SKELETON_VERSION = "6XL1Suao03kp08Jncrb5scelCpWG12rb"
        private const val SKELETON_ID = "human-skeleton"
    }

    private val skeletonRoot: File
        get() = File(context.filesDir, "resources/$SKELETON_ID")

    private val versionFile: File
        get() = File(skeletonRoot, ".version")

    /**
     * Ensure the skeleton asset has been downloaded and extracted. Returns the directory
     * containing the STL files.
     */
    suspend fun ensureSkeletonPresent(): File = withContext(ioDispatcher) {
        if (isSkeletonCurrent()) {
            return@withContext skeletonRoot
        }
        if (skeletonRoot.exists()) {
            skeletonRoot.deleteRecursively()
        }
        skeletonRoot.mkdirs()

        val response = httpClient.newCall(Request.Builder().url(SKELETON_URL).build()).execute()
        if (!response.isSuccessful) {
            throw IOException("Failed to download skeleton asset (HTTP ${response.code})")
        }

        response.body?.byteStream()?.use { input ->
            ZipInputStream(input).use { zipStream ->
                extractZip(zipStream, skeletonRoot)
            }
        } ?: throw IOException("Empty response body while downloading skeleton asset")

        versionFile.writeText(SKELETON_VERSION)
        skeletonRoot
    }

    private fun isSkeletonCurrent(): Boolean {
        if (!skeletonRoot.isDirectory) return false
        if (!versionFile.isFile) return false
        if (versionFile.readText() != SKELETON_VERSION) return false
        return skeletonRoot.listFiles()?.any { it.isFile && it.extension.equals("stl", ignoreCase = true) } == true
    }

    private fun extractZip(zipStream: ZipInputStream, targetDir: File) {
        var entry: ZipEntry? = zipStream.nextEntry
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (entry != null) {
            val destFile = File(targetDir, entry.name)
            if (!destFile.canonicalPath.startsWith(targetDir.canonicalPath)) {
                throw SecurityException("Zip entry path traversal detected: ${entry.name}")
            }
            if (entry.isDirectory) {
                destFile.mkdirs()
            } else {
                destFile.parentFile?.mkdirs()
                FileOutputStream(destFile).use { output ->
                    while (true) {
                        val count = zipStream.read(buffer)
                        if (count == -1) break
                        output.write(buffer, 0, count)
                    }
                }
            }
            zipStream.closeEntry()
            entry = zipStream.nextEntry
        }
    }
}
