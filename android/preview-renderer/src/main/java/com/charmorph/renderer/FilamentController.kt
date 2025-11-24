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
import com.google.android.filament.IndexBuffer
import com.google.android.filament.LightManager
import com.google.android.filament.RenderableManager
import com.google.android.filament.Renderer
import com.google.android.filament.Scene
import com.google.android.filament.Skybox
import com.google.android.filament.SwapChain
import com.google.android.filament.VertexBuffer
import com.google.android.filament.View
import com.google.android.filament.Viewport
import com.google.android.filament.utils.Manipulator
import com.google.android.filament.utils.Utils
import java.nio.ByteBuffer
import java.nio.ByteOrder

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
    
    private val entityMap = mutableMapOf<String, Int>()
    private val bufferMap = mutableMapOf<String, Pair<VertexBuffer, IndexBuffer>>()
    private var cameraManipulator: Manipulator? = null

    init {
        view.scene = scene
        view.camera = camera
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
        cleanup()

        // Create Buffers
        // 1. Flatten Vertices
        val vertexCount = mesh.vertices.size
        val vertexBufferData = ByteBuffer.allocateDirect(vertexCount * 3 * 4)
            .order(ByteOrder.nativeOrder())
        mesh.vertices.forEach { v ->
            vertexBufferData.putFloat(v.x)
            vertexBufferData.putFloat(v.y)
            vertexBufferData.putFloat(v.z)
        }
        vertexBufferData.flip()

        // 2. Create VertexBuffer
        val vb = VertexBuffer.Builder()
            .bufferCount(1)
            .vertexCount(vertexCount)
            .attribute(VertexBuffer.VertexAttribute.POSITION, 0, VertexBuffer.AttributeType.FLOAT3, 0, 12)
            .build(engine)
        vb.setBufferAt(engine, 0, vertexBufferData)

        // 3. Create Entities per Group
        if (mesh.groups.isEmpty()) {
            createEntityForGroup("root", mesh.indices, emptyList(), vb)
        } else {
            mesh.groups.forEach { group ->
                createEntityForGroup(group.name, group.indices, group.tags, vb)
            }
        }
    }
    
    private fun createEntityForGroup(name: String, indices: List<Int>, tags: List<String>, vb: VertexBuffer) {
        // Create IndexBuffer for this group
        val indexCount = indices.size
        val indexBufferData = ByteBuffer.allocateDirect(indexCount * 4)
            .order(ByteOrder.nativeOrder())
        indices.forEach { indexBufferData.putInt(it) }
        indexBufferData.flip()

        val ib = IndexBuffer.Builder()
            .indexCount(indexCount)
            .bufferType(IndexBuffer.Builder.IndexType.UINT)
            .build(engine)
        ib.setBuffer(engine, indexBufferData)
        
        // Track buffers for cleanup
        bufferMap[name] = Pair(vb, ib)

        val entity = EntityManager.get().create()
        RenderableManager.Builder(1)
            .boundingBox(com.google.android.filament.Box(0f, 0f, 0f, 2f, 2f, 2f))
            .geometry(0, RenderableManager.PrimitiveType.TRIANGLES, vb, ib)
            .culling(false)
            // .material(0, materialInstance) // TODO: Add material support
            .build(engine, entity)
        
        scene.addEntity(entity)
        entityMap[name] = entity
    }
    
    private fun cleanup() {
        entityMap.values.forEach { 
            scene.removeEntity(it)
            engine.destroyEntity(it) 
        }
        entityMap.clear()
        
        // Clean up buffers (except VB which might be shared, but here we simplified)
        // In this simplified logic we recreate VB every time, so we should destroy it.
        bufferMap.values.forEach { (vb, ib) ->
             // vb might be duplicated in map, handle carefuly in real app
             engine.destroyIndexBuffer(ib)
        }
        if (bufferMap.isNotEmpty()) {
            engine.destroyVertexBuffer(bufferMap.values.first().first)
        }
        bufferMap.clear()
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
        // Implementation depends on having morph targets compiled into the mesh
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
        cleanup()
        choreographer.removeFrameCallback(this)
        engine.destroyRenderer(renderer)
        engine.destroyView(view)
        engine.destroyScene(scene)
        engine.destroyCameraComponent(camera.entity)
        engine.entityManager.destroy(camera.entity)
        engine.destroy()
    }
}
