package com.charmorph.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Shared data contracts used across ingestion modules.
 *
 * These models intentionally avoid Android dependencies so they can be consumed
 * by workers, storage entities, and network layers without duplication.
 */
@Serializable
data class IngestionJob(
    val id: String,
    val state: JobState,
    val sourceUri: String,
    val createdAtEpochMillis: Long,
    val updatedAtEpochMillis: Long,
    val steps: List<JobStep> = emptyList(),
)

@Serializable
enum class JobState {
    @SerialName("pending")
    Pending,

    @SerialName("running")
    Running,

    @SerialName("completed")
    Completed,

    @SerialName("failed")
    Failed,
}

@Serializable
data class JobStep(
    val name: String,
    val status: StepStatus,
    val progress: Float = 0f,
    val message: String? = null,
)

@Serializable
enum class StepStatus {
    @SerialName("idle")
    Idle,

    @SerialName("in_progress")
    InProgress,

    @SerialName("done")
    Done,

    @SerialName("error")
    Error,
}
