package com.charmorph.asset

import com.charmorph.core.model.Mesh
import com.charmorph.core.model.MeshGroup
import com.charmorph.core.model.Vector2
import com.charmorph.core.model.Vector3

object TestAssetGenerator {
    
    fun createCubeMesh(): Mesh {
        // Simple Cube Vertices
        val vertices = listOf(
            Vector3(-1f, -1f, -1f), Vector3(1f, -1f, -1f), Vector3(1f, 1f, -1f), Vector3(-1f, 1f, -1f),
            Vector3(-1f, -1f, 1f), Vector3(1f, -1f, 1f), Vector3(1f, 1f, 1f), Vector3(-1f, 1f, 1f)
        )
        
        val normals = vertices.map { normalize(it) }
        val uvs = List(8) { Vector2(0f, 0f) } // Dummy UVs

        // Indices for 12 triangles (Cube)
        // Front face
        val indices = listOf(
            0, 1, 2, 2, 3, 0,
            1, 5, 6, 6, 2, 1,
            7, 6, 5, 5, 4, 7,
            4, 0, 3, 3, 7, 4,
            4, 5, 1, 1, 0, 4,
            3, 2, 6, 6, 7, 3
        )
        
        // Create a "Body" group and a "Genitalia" group for testing toggle
        val bodyIndices = indices.take(30)
        val genitalIndices = indices.takeLast(6) // Just the top face as "genitalia" for test
        
        val groups = listOf(
            MeshGroup("Body", bodyIndices, 0, listOf("body")),
            MeshGroup("Genitals", genitalIndices, 0, listOf("genitalia", "anatomical"))
        )

        return Mesh(
            id = "test_cube",
            name = "Test Cube",
            vertices = vertices,
            normals = normals,
            uvs = uvs,
            indices = indices,
            groups = groups
        )
    }

    private fun normalize(v: Vector3): Vector3 {
        val len = Math.sqrt((v.x * v.x + v.y * v.y + v.z * v.z).toDouble()).toFloat()
        return if (len > 0) Vector3(v.x / len, v.y / len, v.z / len) else v
    }
}
