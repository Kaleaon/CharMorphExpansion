package com.charmorph.storage.entity

import androidx.room.Embedded
import androidx.room.Relation

data class CharacterWithPayload(
    @Embedded val character: CharacterEntity,
    @Relation(
        parentColumn = "id",
        entityColumn = "characterId"
    )
    val payload: CharacterPayloadEntity
)
