package com.charmorph.native.bridge

object NativeBridge {
    init {
        runCatching {
            System.loadLibrary("native_bridge")
        }.onFailure {
            // Native bridge is optional for early builds; log once available.
        }
    }

    external fun sampleSummary(): String
}
