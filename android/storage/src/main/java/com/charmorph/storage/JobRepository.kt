package com.charmorph.storage

import com.charmorph.core.model.IngestionJob
import com.charmorph.core.model.JobStep
import com.charmorph.storage.dao.JobDao
import com.charmorph.storage.entities.JobEntity
import com.charmorph.storage.entities.JobStepEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Thin abstraction over Room entities that exposes strongly typed models.
 */
@Singleton
class JobRepository @Inject constructor(
    private val jobDao: JobDao,
) {
    fun observeLatest(limit: Int = 20): Flow<List<IngestionJob>> {
        return jobDao.observeRecent(limit)
            .distinctUntilChanged()
            .flatMapLatest { jobs ->
                if (jobs.isEmpty()) {
                    return@flatMapLatest kotlinx.coroutines.flow.flowOf(emptyList())
                }

                val stepFlows = jobs.map { job ->
                    jobDao.observeSteps(job.id)
                        .map { steps -> job to steps }
                }

                combine(stepFlows) { combined ->
                    combined.map { (job, steps) -> job.toModel(steps) }
                }
            }
    }

    suspend fun upsert(job: IngestionJob) {
        jobDao.upsertJob(JobEntity.fromModel(job))
        val stepEntities = job.steps.mapIndexed { index, step ->
            JobStepEntity.fromModel(job.id, step, index)
        }
        jobDao.replaceSteps(job.id, stepEntities)
    }

    private fun JobEntity.toModel(steps: List<JobStepEntity>): IngestionJob {
        return IngestionJob(
            id = id,
            state = state,
            sourceUri = sourceUri,
            createdAtEpochMillis = createdAt,
            updatedAtEpochMillis = updatedAt,
            steps = steps.map { it.toModel() },
        )
    }

    private fun JobStepEntity.toModel(): JobStep {
        return JobStep(
            name = name,
            status = status,
            progress = progress,
            message = message,
        )
    }
}
