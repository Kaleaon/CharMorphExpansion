package com.charmorph.core.model

import kotlinx.serialization.Serializable

@Serializable
data class CharacterSummary(
    val id: String,
    val name: String,
    val thumbnailPath: String? = null,
    val lastModified: Long = 0L
)
