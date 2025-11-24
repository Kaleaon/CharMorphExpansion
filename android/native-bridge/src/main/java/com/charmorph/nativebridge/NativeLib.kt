package com.charmorph.nativebridge

class NativeLib {
    companion object {
        init {
            System.loadLibrary("charmorph-native")
        }
    }

    external fun stringFromJNI(): String
}
