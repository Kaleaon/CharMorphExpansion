package com.charmorph.storage.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey
import com.charmorph.core.model.IngestionJob
import com.charmorph.core.model.JobState

@Entity(tableName = "jobs")
data class JobEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,
    @ColumnInfo(name = "state")
    val state: JobState,
    @ColumnInfo(name = "source_uri")
    val sourceUri: String,
    @ColumnInfo(name = "created_at")
    val createdAt: Long,
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long,
) {
    companion object {
        fun fromModel(job: IngestionJob): JobEntity {
            return JobEntity(
                id = job.id,
                state = job.state,
                sourceUri = job.sourceUri,
                createdAt = job.createdAtEpochMillis,
                updatedAt = job.updatedAtEpochMillis,
            )
        }
    }
}
