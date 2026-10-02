package com.charmorph.storage.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import com.charmorph.core.model.Mesh
import com.charmorph.core.model.Skeleton
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Entity(tableName = "characters")
data class CharacterEntity(
    @PrimaryKey val id: String,
    val name: String,
    val thumbnailPath: String?,
    val lastModified: Long
)

@Entity(
    tableName = "character_payloads",
    foreignKeys = [
        ForeignKey(
            entity = CharacterEntity::class,
            parentColumns = ["id"],
            childColumns = ["characterId"],
            onDelete = ForeignKey.CASCADE
        )
    ]
)
@TypeConverters(Converters::class)
data class CharacterPayloadEntity(
    @PrimaryKey val characterId: String,
    @field:TypeConverters(Converters::class) val meshData: Mesh,
    @field:TypeConverters(Converters::class) val skeletonData: Skeleton,
    @field:TypeConverters(Converters::class) val morphWeights: Map<String, Float>
)

class Converters {
    private val json = Json { ignoreUnknownKeys = true }

    @TypeConverter
    fun fromMesh(mesh: Mesh): String {
        return json.encodeToString(mesh)
    }

    @TypeConverter
    fun toMesh(value: String): Mesh {
        return json.decodeFromString(value)
    }

    @TypeConverter
    fun fromSkeleton(skeleton: Skeleton): String {
        return json.encodeToString(skeleton)
    }

    @TypeConverter
    fun toSkeleton(value: String): Skeleton {
        return json.decodeFromString(value)
    }

    @TypeConverter
    fun fromMorphWeights(weights: Map<String, Float>): String {
        return json.encodeToString(weights)
    }

    @TypeConverter
    fun toMorphWeights(value: String): Map<String, Float> {
        return json.decodeFromString(value)
    }
}
