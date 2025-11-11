package com.charmorph.storage.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.charmorph.core.model.JobStep
import com.charmorph.core.model.StepStatus

@Entity(
    tableName = "job_steps",
    foreignKeys = [
        ForeignKey(
            entity = JobEntity::class,
            parentColumns = ["id"],
            childColumns = ["job_id"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["job_id"]),
    ],
)
data class JobStepEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "row_id")
    val rowId: Long = 0,
    @ColumnInfo(name = "job_id")
    val jobId: String,
    @ColumnInfo(name = "position")
    val position: Int,
    @ColumnInfo(name = "name")
    val name: String,
    @ColumnInfo(name = "status")
    val status: StepStatus,
    @ColumnInfo(name = "progress")
    val progress: Float,
    @ColumnInfo(name = "message")
    val message: String?,
) {
    companion object {
        fun fromModel(jobId: String, step: JobStep, position: Int): JobStepEntity {
            return JobStepEntity(
                jobId = jobId,
                position = position,
                name = step.name,
                status = step.status,
                progress = step.progress,
                message = step.message,
            )
        }
    }
}
