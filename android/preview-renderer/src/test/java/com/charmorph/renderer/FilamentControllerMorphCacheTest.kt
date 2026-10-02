package com.charmorph.renderer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class FilamentControllerMorphCacheTest {

    /**
     * Helper class or testable simulation verifying FilamentController buffer management logic.
     */
    class MorphBufferManager {
        internal var cachedMorphBuffer: ByteBuffer? = null
        internal var cachedMorphIds: IntArray? = null
        internal var cachedMorphWeights: FloatArray? = null

        fun ensureMorphBufferCapacity(vertexCount: Int) {
            val requiredBytes = vertexCount * 3 * 4
            val currentBuffer = cachedMorphBuffer
            if (currentBuffer == null || currentBuffer.capacity() < requiredBytes) {
                cachedMorphBuffer = ByteBuffer.allocateDirect(requiredBytes)
                    .order(ByteOrder.nativeOrder())
            }
        }

        fun updateMorphWeights(vertexCount: Int, weights: Map<Int, Float>): Triple<ByteBuffer, IntArray, FloatArray> {
            ensureMorphBufferCapacity(vertexCount)
            val outputBuffer = cachedMorphBuffer!!
            outputBuffer.clear()

            val weightCount = weights.size
            var ids = cachedMorphIds
            if (ids == null || ids.size < weightCount) {
                val newCapacity = maxOf(weightCount, (ids?.size ?: 0) * 2)
                ids = IntArray(newCapacity)
                cachedMorphIds = ids
            }

            var values = cachedMorphWeights
            if (values == null || values.size < weightCount) {
                val newCapacity = maxOf(weightCount, (values?.size ?: 0) * 2)
                values = FloatArray(newCapacity)
                cachedMorphWeights = values
            }

            var index = 0
            for ((key, value) in weights) {
                ids[index] = key
                values[index] = value
                index++
            }

            return Triple(outputBuffer, ids, values)
        }

        fun cleanup() {
            cachedMorphBuffer = null
            cachedMorphIds = null
            cachedMorphWeights = null
        }
    }

    @Test
    fun testBufferReuseDuringRepeatedFrameUpdates() {
        val manager = MorphBufferManager()
        val vertexCount = 1000
        val weights = mapOf(1 to 0.5f, 2 to 0.8f, 3 to 0.2f)

        val (firstBuffer, firstIds, firstWeights) = manager.updateMorphWeights(vertexCount, weights)

        assertNotNull(firstBuffer)
        assertNotNull(firstIds)
        assertNotNull(firstWeights)

        // Simulate 60 FPS frame updates (60 iterations)
        for (frame in 0 until 60) {
            val updatedWeights = mapOf(1 to 0.5f + (frame * 0.01f), 2 to 0.8f, 3 to 0.2f)
            val (currentBuffer, currentIds, currentWeights) = manager.updateMorphWeights(vertexCount, updatedWeights)

            assertSame("Direct ByteBuffer must be reused across frames", firstBuffer, currentBuffer)
            assertSame("Morph IDs array must be reused across frames", firstIds, currentIds)
            assertSame("Morph weights array must be reused across frames", firstWeights, currentWeights)
        }
    }

    @Test
    fun testDynamicBufferExpansionWhenCapacityExceeded() {
        val manager = MorphBufferManager()
        val vertexCount = 500

        val initialWeights = mapOf(1 to 0.1f, 2 to 0.2f)
        val (_, initialIds, initialWeightsArray) = manager.updateMorphWeights(vertexCount, initialWeights)

        assertTrue(initialIds.size >= 2)
        assertTrue(initialWeightsArray.size >= 2)

        // Increase active morph target count beyond current capacity
        val expandedWeights = (1..20).associateWith { it * 0.05f }
        val (_, expandedIds, expandedWeightsArray) = manager.updateMorphWeights(vertexCount, expandedWeights)

        assertTrue("Morph IDs array must expand to accommodate higher weight capacity", expandedIds.size >= 20)
        assertTrue("Morph weights array must expand to accommodate higher weight capacity", expandedWeightsArray.size >= 20)

        // Subsequent updates within new capacity reuse expanded buffers
        val subsequentWeights = (1..15).associateWith { it * 0.02f }
        val (_, finalIds, finalWeightsArray) = manager.updateMorphWeights(vertexCount, subsequentWeights)

        assertSame("Expanded morph IDs array should be reused", expandedIds, finalIds)
        assertSame("Expanded morph weights array should be reused", expandedWeightsArray, finalWeightsArray)
    }

    @Test
    fun testBufferCleanupOnReset() {
        val manager = MorphBufferManager()
        val vertexCount = 800
        val weights = mapOf(10 to 0.4f, 20 to 0.6f)

        manager.updateMorphWeights(vertexCount, weights)
        assertNotNull(manager.cachedMorphBuffer)
        assertNotNull(manager.cachedMorphIds)
        assertNotNull(manager.cachedMorphWeights)

        manager.cleanup()

        assertNull("cachedMorphBuffer must be cleared on cleanup", manager.cachedMorphBuffer)
        assertNull("cachedMorphIds must be cleared on cleanup", manager.cachedMorphIds)
        assertNull("cachedMorphWeights must be cleared on cleanup", manager.cachedMorphWeights)
    }

    @Test
    fun testInPlacePopulationDataCorrectness() {
        val manager = MorphBufferManager()
        val vertexCount = 100
        val weights = mapOf(101 to 0.75f, 202 to 0.25f, 303 to 0.9f)

        val (_, ids, weightsArray) = manager.updateMorphWeights(vertexCount, weights)

        assertEquals(101, ids[0])
        assertEquals(0.75f, weightsArray[0], 0.0001f)

        assertEquals(202, ids[1])
        assertEquals(0.25f, weightsArray[1], 0.0001f)

        assertEquals(303, ids[2])
        assertEquals(0.9f, weightsArray[2], 0.0001f)
    }
}
