package com.charmorph.storage.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import com.charmorph.storage.entity.CharacterEntity
import com.charmorph.storage.entity.CharacterPayloadEntity
import com.charmorph.storage.entity.CharacterWithPayload
import kotlinx.coroutines.flow.Flow

@Dao
interface CharacterDao {
    @Query("SELECT * FROM characters ORDER BY lastModified DESC")
    fun getAllCharacters(): Flow<List<CharacterEntity>>

    @Transaction
    @Query("SELECT * FROM characters WHERE id = :id")
    suspend fun getCharacterById(id: String): CharacterWithPayload?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCharacter(character: CharacterEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPayload(payload: CharacterPayloadEntity)

    @Transaction
    suspend fun insertCharacterWithPayload(character: CharacterEntity, payload: CharacterPayloadEntity) {
        insertCharacter(character)
        insertPayload(payload)
    }

    @Update
    suspend fun updateCharacter(character: CharacterEntity)

    @Update
    suspend fun updatePayload(payload: CharacterPayloadEntity)

    @Transaction
    suspend fun updateMorphWeights(id: String, weights: Map<String, Float>, lastModified: Long) {
        val existing = getCharacterById(id)
        if (existing != null) {
            updateCharacter(existing.character.copy(lastModified = lastModified))
            updatePayload(existing.payload.copy(morphWeights = weights))
        }
    }

    @Query("DELETE FROM characters WHERE id = :id")
    suspend fun deleteCharacter(id: String)
}
