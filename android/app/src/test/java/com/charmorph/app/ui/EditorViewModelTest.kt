package com.charmorph.app.ui

import androidx.lifecycle.SavedStateHandle
import com.charmorph.core.model.Mesh
import com.charmorph.core.model.Skeleton
import com.charmorph.storage.CharacterRepository
import com.charmorph.storage.dao.CharacterDao
import com.charmorph.storage.entity.CharacterEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class EditorViewModelTest {

    private val testScheduler = TestCoroutineScheduler()
    private val testDispatcher = StandardTestDispatcher(testScheduler)
    private lateinit var fakeDao: FakeCharacterDao
    private lateinit var repository: CharacterRepository
    private lateinit var viewModel: EditorViewModel

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        fakeDao = FakeCharacterDao()
        repository = CharacterRepository(fakeDao)
        val savedStateHandle = SavedStateHandle(mapOf("characterId" to "test_char"))
        viewModel = EditorViewModel(repository, savedStateHandle)
        testScheduler.advanceUntilIdle()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun updateMorph_updatesInMemoryStateImmediately() {
        viewModel.updateMorph("body_fat", 0.75f)
        val fatMorph = viewModel.uiState.value.morphs.find { it.name == "body_fat" }
        assertEquals(0.75f, fatMorph?.value ?: 0f, 0.001f)
        assertEquals(0, fakeDao.updateCount)
    }

    @Test
    fun updateMorph_debouncesDatabaseWritesBy300ms() = runTest(testDispatcher) {
        viewModel.updateMorph("body_fat", 0.5f)
        assertEquals(0, fakeDao.updateCount)

        // Advance 200ms - should not have saved yet
        testScheduler.advanceTimeBy(200L)
        assertEquals(0, fakeDao.updateCount)

        // Advance remaining 150ms - should trigger save
        testScheduler.advanceTimeBy(150L)
        testScheduler.advanceUntilIdle()
        assertEquals(1, fakeDao.updateCount)
        assertEquals(0.5f, fakeDao.savedWeights["body_fat"] ?: 0f, 0.001f)
    }

    @Test
    fun continuousUpdates_onlyTriggersSingleSaveAfterSettle() = runTest(testDispatcher) {
        // Simulate dragging a slider rapidly over 500ms
        for (i in 1..5) {
            viewModel.updateMorph("body_fat", i * 0.1f)
            testScheduler.advanceTimeBy(100L)
        }
        // During continuous dragging, 0 database writes should occur
        assertEquals(0, fakeDao.updateCount)

        // Wait 350ms after dragging stops
        testScheduler.advanceTimeBy(350L)
        testScheduler.advanceUntilIdle()

        // Exactly 1 update with final value 0.5f
        assertEquals(1, fakeDao.updateCount)
        assertEquals(0.5f, fakeDao.savedWeights["body_fat"] ?: 0f, 0.001f)
    }

    @Test
    fun flushSave_immediatelyPersistsUnsavedState() = runTest(testDispatcher) {
        viewModel.updateMorph("body_fat", 0.9f)
        assertEquals(0, fakeDao.updateCount)

        viewModel.flushSave()
        testScheduler.advanceUntilIdle()

        assertEquals(1, fakeDao.updateCount)
        assertEquals(0.9f, fakeDao.savedWeights["body_fat"] ?: 0f, 0.001f)
    }

    private class FakeCharacterDao : CharacterDao {
        var updateCount = 0
        val savedWeights = mutableMapOf<String, Float>()
        private var entity = CharacterEntity(
            id = "test_char",
            name = "Test Character",
            thumbnailPath = null,
            lastModified = System.currentTimeMillis(),
            meshData = Mesh(id = "m1", name = "base", vertices = emptyList(), normals = emptyList(), uvs = emptyList(), indices = emptyList()),
            skeletonData = Skeleton(emptyList()),
            morphWeights = emptyMap()
        )

        override fun getAllCharacters(): Flow<List<CharacterEntity>> = flowOf(listOf(entity))
        override suspend fun getCharacterById(id: String): CharacterEntity? = entity
        override suspend fun insertCharacter(character: CharacterEntity) { entity = character }
        override suspend fun updateCharacter(character: CharacterEntity) {
            updateCount++
            savedWeights.clear()
            savedWeights.putAll(character.morphWeights)
            entity = character
        }
        override suspend fun deleteCharacter(id: String) {}
    }
}
