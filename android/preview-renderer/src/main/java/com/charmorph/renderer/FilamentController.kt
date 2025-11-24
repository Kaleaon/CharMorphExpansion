package com.charmorph.renderer

import android.content.Context
import android.view.Choreographer
import android.view.SurfaceHolder
import android.view.SurfaceView
import com.charmorph.core.model.Mesh
import com.google.android.filament.Camera
import com.google.android.filament.Colors
import com.google.android.filament.Engine
import com.google.android.filament.EntityManager
import com.google.android.filament.LightManager
import com.google.android.filament.Renderer
import com.google.android.filament.Scene
import com.google.android.filament.Skybox
import com.google.android.filament.SwapChain
import com.google.android.filament.View
import com.google.android.filament.Viewport
import com.google.android.filament.utils.Manipulator
import com.google.android.filament.utils.Utils

class FilamentController(
    private val context: Context,
    private val surfaceView: SurfaceView
) : Choreographer.FrameCallback {

    private var engine: Engine = Engine.create()
    private var renderer: Renderer = engine.createRenderer()
    private var scene: Scene = engine.createScene()
    private var view: View = engine.createView()
    private var camera: Camera = engine.createCamera(engine.entityManager.create())
    private var swapChain: SwapChain? = null
    private var choreographer: Choreographer = Choreographer.getInstance()
    
    private val entityMap = mutableMapOf<String, Int>() // Maps Group Name to Entity ID
    private var cameraManipulator: Manipulator? = null

    init {
        view.scene = scene
        view.camera = camera
        
        // Lighting Setup
        setupLighting()
        setupManipulator()
        
        surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                swapChain = engine.createSwapChain(holder.surface)
                choreographer.postFrameCallback(this@FilamentController)
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                view.viewport = Viewport(0, 0, width, height)
                val aspect = width.toDouble() / height.toDouble()
                camera.setProjection(45.0, aspect, 0.1, 20.0, Camera.Fov.VERTICAL)
                cameraManipulator?.setViewport(width, height)
            }

            override fun surfaceDestroyed(holder: SurfaceHolder) {
                choreographer.removeFrameCallback(this@FilamentController)
                swapChain?.let { engine.destroySwapChain(it) }
                swapChain = null
            }
        })
    }
    
    private fun setupLighting() {
        scene.skybox = Skybox.Builder().color(0.1f, 0.1f, 0.1f, 1.0f).build(engine)
        
        val light = EntityManager.get().create()
        LightManager.Builder(LightManager.Type.DIRECTIONAL)
            .color(1.0f, 0.95f, 0.9f)
            .intensity(100000.0f)
            .direction(1.0f, -0.5f, -1.0f)
            .build(engine, light)
        scene.addEntity(light)
    }
    
    private fun setupManipulator() {
        cameraManipulator = Manipulator.Builder()
            .targetPosition(0.0f, 1.0f, 0.0f)
            .build(Manipulator.Mode.ORBIT)
    }

    fun loadMesh(mesh: Mesh) {
        // Clear existing
        entityMap.values.forEach { 
            scene.removeEntity(it)
            engine.destroyEntity(it) 
        }
        entityMap.clear()

        // In a real app, we would create separate entities per group.
        // For now, we simulate creating entities.
        if (mesh.groups.isEmpty()) {
             createEntityForGroup("root", mesh.indices, emptyList())
        } else {
            mesh.groups.forEach { group ->
                createEntityForGroup(group.name, group.indices, group.tags)
            }
        }
    }
    
    private fun createEntityForGroup(name: String, indices: List<Int>, tags: List<String>) {
        val entity = EntityManager.get().create()
        // Real implementation would attach Renderable with Morphing enabled
        // RenderableManager.Builder(1)
        //    .morphing(true) 
        //    .build(engine, entity)
        
        // scene.addEntity(entity)
        entityMap[name] = entity
    }
    
    fun setGroupVisibility(name: String, visible: Boolean) {
        val entity = entityMap[name] ?: return
        val rm = engine.renderableManager
        val instance = rm.getInstance(entity)
        if (instance != 0) {
            rm.setLayerMask(instance, 0xff, if (visible) 0xff else 0x00) 
        }
    }

    fun setMorphWeight(targetName: String, weight: Float) {
        // Filament requires setting morph weights by index.
        // We need a mapping from "targetName" -> "index" which should be provided by the Asset/Mesh data.
        // Assuming we have the index 'idx':
        
        // val idx = mesh.morphTargetMap[targetName]
        // entityMap.values.forEach { entity ->
        //     val instance = engine.renderableManager.getInstance(entity)
        //     engine.renderableManager.setMorphWeights(instance, floatArrayOf(...))
        // }
        
        // For now, this is a placeholder to indicate where the logic goes.
    }

    override fun doFrame(frameTimeNanos: Long) {
        choreographer.postFrameCallback(this)
        
        cameraManipulator?.update(frameTimeNanos.toFloat())
        
        if (view.viewport.width > 0 && view.viewport.height > 0) {
            if (renderer.beginFrame(swapChain!!, frameTimeNanos)) {
                renderer.render(view)
                renderer.endFrame()
            }
        }
    }

    fun destroy() {
        choreographer.removeFrameCallback(this)
        engine.destroyRenderer(renderer)
        engine.destroyView(view)
        engine.destroyScene(scene)
        engine.destroyCameraComponent(camera.entity)
        engine.entityManager.destroy(camera.entity)
        engine.destroy()
    }
}
