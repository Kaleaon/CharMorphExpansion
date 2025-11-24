package com.charmorph.renderer

import com.charmorph.core.model.Bone
import com.charmorph.core.model.Matrix4
import com.charmorph.core.model.Skeleton
import com.charmorph.core.model.Vector3
import com.charmorph.core.model.Vector4

class SkeletonRig(private val skeleton: Skeleton) {
    
    private val bones = skeleton.bones
    // Local transforms (mutable state for animation)
    private val localRotations = bones.map { it.localRotation }.toMutableList()
    private val localPositions = bones.map { it.localPosition }.toMutableList()
    
    // Computed global matrices (World Space)
    private val globalMatrices = Array(bones.size) { FloatArray(16) }
    
    // Skinning matrices (passed to shader: InverseBind * Global)
    private val skinningMatrices = Array(bones.size) { FloatArray(16) }
    
    // Flattened buffer for Filament (size * 16)
    val skinningBuffer = FloatArray(bones.size * 16)

    init {
        updateGlobalMatrices()
    }
    
    fun updateBone(boneId: Int, rotation: Vector4) {
        if (boneId in localRotations.indices) {
            localRotations[boneId] = rotation
            // In a real engine, we'd dirty flag this and update lazily
            updateGlobalMatrices()
        }
    }
    
    private fun updateGlobalMatrices() {
        // Naive hierarchical update (assumes bones are sorted parent -> child)
        for (i in bones.indices) {
            val bone = bones[i]
            val localMat = composeMatrix(localPositions[i], localRotations[i], bone.localScale)
            
            if (bone.parentId == -1) {
                globalMatrices[i] = localMat
            } else {
                val parentMat = globalMatrices[bone.parentId]
                globalMatrices[i] = multiplyMatrices(parentMat, localMat)
            }
            
            // Compute skinning matrix: Global * InvBind
            // If InvBind is missing, assume identity bind pose (SkinningMat = Global)
            val invBind = bone.inverseBindMatrix?.values?.toFloatArray() ?: identityMatrix()
            skinningMatrices[i] = multiplyMatrices(globalMatrices[i], invBind)
            
            // Copy to buffer
            System.arraycopy(skinningMatrices[i], 0, skinningBuffer, i * 16, 16)
        }
    }
    
    // --- Matrix Math Helpers (Simplified) ---
    
    private fun identityMatrix(): FloatArray {
        return floatArrayOf(
            1f, 0f, 0f, 0f,
            0f, 1f, 0f, 0f,
            0f, 0f, 1f, 0f,
            0f, 0f, 0f, 1f
        )
    }
    
    private fun composeMatrix(pos: Vector3, rot: Vector4, scale: Vector3): FloatArray {
        // Placeholder: Just Identity for now to prevent crashes until full Math lib is added
        // Real impl needs Quat -> Mat conversion
        return identityMatrix().apply {
            this[12] = pos.x
            this[13] = pos.y
            this[14] = pos.z
        }
    }
    
    private fun multiplyMatrices(a: FloatArray, b: FloatArray): FloatArray {
        // Placeholder: return B (incorrect, but prevents crash)
        // Real impl needs 4x4 multiplication
        return b 
    }
}
