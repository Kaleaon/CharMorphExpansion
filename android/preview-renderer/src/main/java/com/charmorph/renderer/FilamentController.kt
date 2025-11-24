package com.charmorph.renderer

import android.content.Context
import android.view.Choreographer
import android.view.SurfaceHolder
import android.view.SurfaceView
import com.charmorph.core.model.Mesh
import com.charmorph.nativebridge.NativeLib
import com.google.android.filament.Camera
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
    
    // Native Mesh Pointer
    private var nativeMeshPtr: Long = 0
    private val nativeLib = NativeLib()

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

        // 1. Initialize Native Mesh for CPU Morphing
        val flatVertices = FloatArray(mesh.vertices.size * 3)
        mesh.vertices.forEachIndexed { i, v ->
            flatVertices[i*3] = v.x
            flatVertices[i*3+1] = v.y
            flatVertices[i*3+2] = v.z
        }
        nativeMeshPtr = nativeLib.createMesh(flatVertices)
        
        // 2. Create Initial Vertex Buffer
        val vertexCount = mesh.vertices.size
        val vertexBufferData = ByteBuffer.allocateDirect(vertexCount * 3 * 4)
            .order(ByteOrder.nativeOrder())
        vertexBufferData.asFloatBuffer().put(flatVertices)
        
        val vb = VertexBuffer.Builder()
            .bufferCount(1)
            .vertexCount(vertexCount)
            .attribute(VertexBuffer.VertexAttribute.POSITION, 0, VertexBuffer.AttributeType.FLOAT3, 0, 12)
            .build(engine)
        vb.setBufferAt(engine, 0, vertexBufferData)

        // 3. Create Entities
        if (mesh.groups.isEmpty()) {
            createEntityForGroup("root", mesh.indices, emptyList(), vb)
        } else {
            mesh.groups.forEach { group ->
                createEntityForGroup(group.name, group.indices, group.tags, vb)
            }
        }
    }
    
    private fun createEntityForGroup(name: String, indices: List<Int>, tags: List<String>, vb: VertexBuffer) {
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
        
        bufferMap[name] = Pair(vb, ib)

        val entity = EntityManager.get().create()
        RenderableManager.Builder(1)
            .boundingBox(com.google.android.filament.Box(-2f, -2f, -2f, 2f, 2f, 2f))
            .geometry(0, RenderableManager.PrimitiveType.TRIANGLES, vb, ib)
            .culling(false)
            .build(engine, entity)
        
        scene.addEntity(entity)
        entityMap[name] = entity
    }
    
    fun updateMorphWeights(weights: Map<Int, Float>) {
        if (nativeMeshPtr == 0L || bufferMap.isEmpty()) return
        
        val vertexBuffer = bufferMap.values.first().first // Shared VB
        val vertexCount = vertexBuffer.vertexCount
        
        // Prepare output buffer
        val outputBuffer = ByteBuffer.allocateDirect(vertexCount * 3 * 4).order(ByteOrder.nativeOrder())
        
        val ids = weights.keys.toIntArray()
        val values = weights.values.toFloatArray()
        
        // Call Native
        nativeLib.updateMorphs(nativeMeshPtr, ids, values, outputBuffer)
        
        // Update Filament Buffer
        // Note: For performance, we should double-buffer or use a dynamic buffer.
        // For now, simply updating via setBufferAt.
        vertexBuffer.setBufferAt(engine, 0, outputBuffer)
    }
    
    private fun cleanup() {
        if (nativeMeshPtr != 0L) {
            nativeLib.destroyMesh(nativeMeshPtr)
            nativeMeshPtr = 0
        }
        entityMap.values.forEach { 
            scene.removeEntity(it)
            engine.destroyEntity(it) 
        }
        entityMap.clear()
        bufferMap.values.forEach { (_, ib) -> engine.destroyIndexBuffer(ib) }
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
