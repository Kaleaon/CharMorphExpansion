package com.charmorph.ml.engine

import android.content.Context
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.Interpreter.Options
import java.nio.ByteBuffer

/**
 * Thin wrapper around a TensorFlow Lite interpreter so downstream modules can
 * depend on a stable API while the actual models are integrated.
 */
class ModelHandle(
    private val context: Context,
    private val modelAssetName: String,
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : AutoCloseable {

    private var interpreter: Interpreter? = null

    suspend fun ensureLoaded() = withContext(dispatcher) {
        if (interpreter != null) return@withContext
        val buffer = loadModelFile()
        interpreter = Interpreter(buffer, Options().apply { setNumThreads(2) })
    }

    suspend fun runInference(
        input: Any,
        output: Any,
    ) = withContext(dispatcher) {
        ensureLoaded()
        interpreter?.run(input, output)
    }

    private fun loadModelFile(): ByteBuffer {
        return context.assets.openFd(modelAssetName).use { fd ->
            val inputStream = fd.createInputStream()
            val bytes = ByteArray(fd.length.toInt())
            inputStream.read(bytes)
            ByteBuffer.wrap(bytes)
        }
    }

    override fun close() {
        interpreter?.close()
        interpreter = null
    }
}
