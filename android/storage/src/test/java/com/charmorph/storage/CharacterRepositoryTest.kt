package com.charmorph.storage

import com.charmorph.core.model.Mesh
import com.charmorph.core.model.Skeleton
import com.charmorph.storage.dao.CharacterDao
import com.charmorph.storage.entity.CharacterEntity
import com.charmorph.storage.entity.CharacterSummaryEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class CharacterRepositoryTest {

    private class FakeCharacterDao : CharacterDao {
        val storage = mutableMapOf<String, CharacterEntity>()

        override fun getAllCharacters(): Flow<List<CharacterEntity>> = kotlinx.coroutines.flow.flow {
            emit(storage.values.sortedByDescending { it.lastModified })
        }

        override fun getCharacterSummaries(): Flow<List<CharacterSummaryEntity>> = kotlinx.coroutines.flow.flow {
            val summaries = storage.values.map {
                CharacterSummaryEntity(
                    id = it.id,
                    name = it.name,
                    thumbnailPath = it.thumbnailPath,
                    lastModified = it.lastModified
                )
            }.sortedByDescending { it.lastModified }
            emit(summaries)
        }

        override suspend fun getCharacterById(id: String): CharacterEntity? {
            return storage[id]
        }

        override suspend fun insertCharacter(character: CharacterEntity) {
            storage[character.id] = character
        }

        override suspend fun updateCharacter(character: CharacterEntity) {
            storage[character.id] = character
        }

        override suspend fun deleteCharacter(id: String) {
            storage.remove(id)
        }
    }

    @Test
    fun testCharacterSummariesMapping() = runTest {
        val fakeDao = FakeCharacterDao()
        val repository = CharacterRepository(fakeDao)

        val entity1 = CharacterEntity(
            id = "char-1",
            name = "Hero Character",
            thumbnailPath = "/thumbs/hero.png",
            lastModified = 1000L,
            meshData = Mesh("m1", "Hero Mesh", emptyList(), emptyList(), emptyList(), emptyList()),
            skeletonData = Skeleton(emptyList()),
            morphWeights = mapOf("muscle" to 0.8f)
        )
        fakeDao.insertCharacter(entity1)

        val summaries = repository.characterSummaries.first()
        assertEquals(1, summaries.size)

        val summary = summaries.first()
        assertEquals("char-1", summary.id)
        assertEquals("Hero Character", summary.name)
        assertEquals("/thumbs/hero.png", summary.thumbnailPath)
        assertEquals(1000L, summary.lastModified)
    }

    @Test
    fun testGetCharacterByIdLoadsFullPayload() = runTest {
        val fakeDao = FakeCharacterDao()
        val repository = CharacterRepository(fakeDao)

        val entity1 = CharacterEntity(
            id = "char-2",
            name = "Detailed Character",
            thumbnailPath = null,
            lastModified = 2000L,
            meshData = Mesh("m2", "Detailed Mesh", emptyList(), emptyList(), emptyList(), emptyList()),
            skeletonData = Skeleton(emptyList()),
            morphWeights = mapOf("fat" to 0.2f)
        )
        fakeDao.insertCharacter(entity1)

        val character = repository.getCharacter("char-2")
        assertNotNull(character)
        assertEquals("char-2", character?.id)
        assertEquals("Detailed Mesh", character?.baseMesh?.name)
        assertEquals(mapOf("fat" to 0.2f), character?.activeMorphs)
    }

    @Test
    fun testToDomainModelMapperForSummary() {
        val summaryEntity = CharacterSummaryEntity(
            id = "s-123",
            name = "Summary Model",
            thumbnailPath = "path/to/thumb",
            lastModified = 123456789L
        )

        val domainModel = summaryEntity.toDomainModel()
        assertEquals("s-123", domainModel.id)
        assertEquals("Summary Model", domainModel.name)
        assertEquals("path/to/thumb", domainModel.thumbnailPath)
        assertEquals(123456789L, domainModel.lastModified)
    }
}
