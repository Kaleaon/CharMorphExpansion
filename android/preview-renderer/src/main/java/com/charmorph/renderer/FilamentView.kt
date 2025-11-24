package com.charmorph.renderer

import android.content.Context
import android.util.AttributeSet
import android.view.SurfaceView
import com.charmorph.core.model.Mesh
import com.google.android.filament.utils.Utils

class FilamentView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : SurfaceView(context, attrs, defStyleAttr) {

    private var controller: FilamentController? = null
    private var currentMesh: Mesh? = null
    private var showAnatomicalDetails: Boolean = false
    
    // Cache current weights to batch updates if needed
    private val currentWeights = mutableMapOf<Int, Float>()

    init {
        Utils.init() // Ensure Filament JNI is loaded
        controller = FilamentController(context, this)
    }

    fun destroy() {
        controller?.destroy()
        controller = null
    }
    
    fun loadMesh(mesh: Mesh) {
        currentMesh = mesh
        controller?.loadMesh(mesh)
        updateVisibility()
    }

    fun setAnatomicalDetailsVisible(visible: Boolean) {
        if (showAnatomicalDetails != visible) {
            showAnatomicalDetails = visible
            updateVisibility()
        }
    }
    
    fun updateMorphWeight(targetName: String, weight: Float) {
        // For now, use a dummy ID mapping since we don't have real Morph definitions loaded yet.
        // In reality, Mesh would contain a list of MorphTargets with IDs.
        val morphId = targetName.hashCode() 
        currentWeights[morphId] = weight
        controller?.updateMorphWeights(currentWeights)
    }

    private fun updateVisibility() {
        val mesh = currentMesh ?: return
        mesh.groups.forEach { group ->
             val isSensitive = group.tags.contains("anatomical") || group.tags.contains("genitalia")
             val shouldRender = !isSensitive || showAnatomicalDetails
             controller?.setGroupVisibility(group.name, shouldRender)
        }
    }
}
