package com.charmorph.renderer

import android.content.Context
import android.util.AttributeSet
import android.view.SurfaceView
import com.charmorph.core.model.Mesh
import com.charmorph.core.model.MeshGroup
import com.google.android.filament.utils.Utils

class FilamentView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : SurfaceView(context, attrs, defStyleAttr) {

    private var controller: FilamentController? = null
    private var currentMesh: Mesh? = null
    private var showAnatomicalDetails: Boolean = false

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
        updateVisibility()
    }

    fun setAnatomicalDetailsVisible(visible: Boolean) {
        if (showAnatomicalDetails != visible) {
            showAnatomicalDetails = visible
            updateVisibility()
        }
    }

    private fun updateVisibility() {
        val mesh = currentMesh ?: return
        
        // In a real implementation, we would traverse the Renderables created for this mesh
        // and hide/show entities based on the group tags.
        // 
        // Example logic:
        // mesh.groups.forEach { group ->
        //     val isSensitive = group.tags.contains("genitalia")
        //     val shouldRender = !isSensitive || showAnatomicalDetails
        //     controller?.setEntityVisible(group.name, shouldRender)
        // }
    }
}
