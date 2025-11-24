package com.charmorph.nativebridge

class NativeLib {
    companion object {
        init {
            System.loadLibrary("charmorph-native")
        }
    }

    external fun stringFromJNI(): String
    
    /**
     * Solves for morph weights given a set of 2D landmarks and a base mesh.
     * 
     * @param landmarks Array of floats [x0, y0, x1, y1, ...]
     * @param baseVertices Array of floats [x0, y0, z0, x1, y1, z1, ...]
     * @param morphDeltas Flattened array of morph targets (simplified for JNI passing)
     * @return Array of floats representing weights for each morph target
     */
    external fun solveMorphWeights(
        landmarks: FloatArray,
        baseVertices: FloatArray,
        morphIndices: IntArray,
        morphDeltas: FloatArray
    ): FloatArray
}
