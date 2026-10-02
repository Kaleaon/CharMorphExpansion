package com.charmorph.ingest

import com.charmorph.core.model.Vector2
import com.charmorph.core.model.Vector3
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

class ObjParserTest {

    @Test
    fun parse_validObjString_parsesVerticesNormalsUvsGroupsAndFaces() {
        val objContent = """
            # Sample OBJ File
            
            v  1.0  2.0  3.0
            v  4.0  5.0  6.0
            v  7.0  8.0  9.0
            
            vt 0.1 0.2
            vt 0.3 0.4
            vt 0.5 0.6
            
            vn 0.0 1.0 0.0
            vn 0.0 0.0 1.0
            vn 1.0 0.0 0.0
            
            g  genital_area
            f 1/1/1 2/2/2 3/3/3
            
            g group_two
            f 3/3/3 2/2/2 1/1/1
        """.trimIndent()

        val inputStream = ByteArrayInputStream(objContent.toByteArray(Charsets.UTF_8))
        val mesh = ObjParser.parse(inputStream, "test_mesh")

        assertEquals("test_mesh", mesh.name)
        assertNotNull(mesh.id)

        // Check vertices count & values (finalVertices reindexed)
        assertEquals(3, mesh.vertices.size)
        assertEquals(Vector3(1.0f, 2.0f, 3.0f), mesh.vertices[0])
        assertEquals(Vector3(4.0f, 5.0f, 6.0f), mesh.vertices[1])
        assertEquals(Vector3(7.0f, 8.0f, 9.0f), mesh.vertices[2])

        // Check UVs
        assertEquals(3, mesh.uvs.size)
        assertEquals(Vector2(0.1f, 0.2f), mesh.uvs[0])
        assertEquals(Vector2(0.3f, 0.4f), mesh.uvs[1])
        assertEquals(Vector2(0.5f, 0.6f), mesh.uvs[2])

        // Check Normals
        assertEquals(3, mesh.normals.size)
        assertEquals(Vector3(0.0f, 1.0f, 0.0f), mesh.normals[0])
        assertEquals(Vector3(0.0f, 0.0f, 1.0f), mesh.normals[1])
        assertEquals(Vector3(1.0f, 0.0f, 0.0f), mesh.normals[2])

        // Check Indices
        assertEquals(6, mesh.indices.size)
        assertEquals(listOf(0, 1, 2, 2, 1, 0), mesh.indices)

        // Check Groups
        assertEquals(2, mesh.groups.size)

        val group1 = mesh.groups[0]
        assertEquals("genital_area", group1.name)
        assertEquals(listOf(0, 1, 2), group1.indices)
        assertTrue(group1.tags.contains("genitalia"))
        assertTrue(group1.tags.contains("anatomical"))

        val group2 = mesh.groups[1]
        assertEquals("group_two", group2.name)
        assertEquals(listOf(2, 1, 0), group2.indices)
        assertTrue(group2.tags.isEmpty())
    }

    @Test
    fun parse_irregularWhitespaceAndTabs_parsesCorrectly() {
        val objContent = "\tv \t 1.5   2.5 \t 3.5 \n\tvt \t0.25   0.75 \n\tvn   0.0  0.0  1.0 \n\t   \nf 1/1/1 1/1/1 1/1/1\n"
        val inputStream = ByteArrayInputStream(objContent.toByteArray(Charsets.UTF_8))
        val mesh = ObjParser.parse(inputStream, "whitespace_mesh")

        assertEquals(1, mesh.vertices.size)
        assertEquals(Vector3(1.5f, 2.5f, 3.5f), mesh.vertices[0])
        assertEquals(Vector2(0.25f, 0.75f), mesh.uvs[0])
        assertEquals(Vector3(0.0f, 0.0f, 1.0f), mesh.normals[0])
        assertEquals(listOf(0, 0, 0), mesh.indices)
    }

    @Test
    fun parse_missingUvsOrNormalsInFace_usesDefaults() {
        val objContent = """
            v 1.0 0.0 0.0
            v 0.0 1.0 0.0
            v 0.0 0.0 1.0
            f 1// 2// 3//
        """.trimIndent()

        val inputStream = ByteArrayInputStream(objContent.toByteArray(Charsets.UTF_8))
        val mesh = ObjParser.parse(inputStream, "no_uv_or_normal_mesh")

        assertEquals(3, mesh.vertices.size)
        assertEquals(Vector2(0f, 0f), mesh.uvs[0])
        assertEquals(Vector3(0f, 1f, 0f), mesh.normals[0])
    }

    @Test
    fun parse_objectTag_treatedAsGroup() {
        val objContent = """
            v 0 0 0
            v 1 0 0
            v 0 1 0
            o object_body
            f 1 2 3
        """.trimIndent()

        val inputStream = ByteArrayInputStream(objContent.toByteArray(Charsets.UTF_8))
        val mesh = ObjParser.parse(inputStream, "object_tag_mesh")

        assertEquals(1, mesh.groups.size)
        assertEquals("object_body", mesh.groups[0].name)
    }
}
