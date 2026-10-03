package com.charmorph.storage

import com.charmorph.core.model.Character
import com.charmorph.core.model.CharacterSummary
import com.charmorph.core.model.Mesh
import com.charmorph.core.model.Skeleton
import com.charmorph.storage.dao.CharacterDao
import com.charmorph.storage.entity.CharacterEntity
import com.charmorph.storage.entity.CharacterSummaryEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CharacterRepository @Inject constructor(
    private val characterDao: CharacterDao
) {
    val characterSummaries: Flow<List<CharacterSummary>> = characterDao.getCharacterSummaries().map { entities ->
        entities.map { it.toDomainModel() }
    }

    val allCharacters: Flow<List<Character>> = characterDao.getAllCharacters().map { entities ->
        entities.map { it.toDomainModel() }
    }

    suspend fun getCharacter(id: String): Character? {
        return characterDao.getCharacterById(id)?.toDomainModel()
    }

    suspend fun saveCharacter(character: Character) {
        characterDao.insertCharacter(character.toEntity())
    }

    suspend fun updateMorphWeights(id: String, weights: Map<String, Float>) {
        val entity = characterDao.getCharacterById(id)
        if (entity != null) {
            val updatedEntity = entity.copy(
                morphWeights = weights,
                lastModified = System.currentTimeMillis()
            )
            characterDao.updateCharacter(updatedEntity)
        }
    }
}

// Mappers
fun CharacterSummaryEntity.toDomainModel(): CharacterSummary {
    return CharacterSummary(
        id = id,
        name = name,
        thumbnailPath = thumbnailPath,
        lastModified = lastModified
    )
}

fun CharacterEntity.toDomainModel(): Character {
    return Character(
        id = id,
        baseMesh = meshData,
        skeleton = skeletonData,
        activeMorphs = morphWeights
    )
}

fun Character.toEntity(): CharacterEntity {
    return CharacterEntity(
        id = id,
        name = if (baseMesh.name.isNotBlank()) baseMesh.name else "Character",
        thumbnailPath = null,
        lastModified = System.currentTimeMillis(),
        meshData = baseMesh,
        skeletonData = skeleton,
        morphWeights = activeMorphs
    )
}
