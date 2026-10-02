package com.charmorph.storage.entity

data class CharacterSummaryEntity(
    val id: String,
    val name: String,
    val thumbnailPath: String?,
    val lastModified: Long
)
