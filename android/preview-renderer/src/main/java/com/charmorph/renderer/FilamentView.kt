package com.charmorph.renderer

import android.content.Context
import android.util.AttributeSet
import android.view.SurfaceView
import com.google.android.filament.utils.Utils

class FilamentView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : SurfaceView(context, attrs, defStyleAttr) {

    private var controller: FilamentController? = null

    init {
        Utils.init() // Ensure Filament JNI is loaded
        controller = FilamentController(context, this)
    }

    fun destroy() {
        controller?.destroy()
        controller = null
    }
    
    // API to load mesh, etc.
    fun loadMesh(meshData: Any) {
        // specific implementation to pass data to controller/scene
    }
}
