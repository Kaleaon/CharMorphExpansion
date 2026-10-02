package com.charmorph.storage

import com.charmorph.core.model.Character
import com.charmorph.storage.dao.CharacterDao
import com.charmorph.storage.entity.CharacterEntity
import com.charmorph.storage.entity.CharacterPayloadEntity
import com.charmorph.storage.entity.CharacterWithPayload
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CharacterRepository @Inject constructor(
    private val characterDao: CharacterDao
) {
    val allCharacters: Flow<List<CharacterEntity>> = characterDao.getAllCharacters()

    suspend fun getCharacter(id: String): Character? {
        return characterDao.getCharacterById(id)?.toDomainModel()
    }

    suspend fun saveCharacter(character: Character, name: String = character.baseMesh.name) {
        val (entity, payload) = character.toEntityPair(name)
        characterDao.insertCharacterWithPayload(entity, payload)
    }

    suspend fun updateMorphWeights(id: String, weights: Map<String, Float>) {
        characterDao.updateMorphWeights(id, weights, System.currentTimeMillis())
    }
}

// Mappers
fun CharacterWithPayload.toDomainModel(): Character {
    return Character(
        id = character.id,
        baseMesh = payload.meshData,
        skeleton = payload.skeletonData,
        activeMorphs = payload.morphWeights
    )
}

fun Character.toEntityPair(name: String = baseMesh.name.ifEmpty { "Character" }): Pair<CharacterEntity, CharacterPayloadEntity> {
    val now = System.currentTimeMillis()
    val characterEntity = CharacterEntity(
        id = id,
        name = name,
        thumbnailPath = null,
        lastModified = now
    )
    val payloadEntity = CharacterPayloadEntity(
        characterId = id,
        meshData = baseMesh,
        skeletonData = skeleton,
        morphWeights = activeMorphs
    )
    return Pair(characterEntity, payloadEntity)
}
