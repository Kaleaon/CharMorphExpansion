package com.charmorph.storage.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.charmorph.storage.entities.JobEntity
import com.charmorph.storage.entities.JobStepEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface JobDao {
    @Query("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT :limit")
    fun observeRecent(limit: Int = 20): Flow<List<JobEntity>>

    @Query("SELECT * FROM job_steps WHERE job_id = :jobId ORDER BY position ASC")
    fun observeSteps(jobId: String): Flow<List<JobStepEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertJob(job: JobEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSteps(steps: List<JobStepEntity>)

    @Transaction
    suspend fun replaceSteps(jobId: String, steps: List<JobStepEntity>) {
        deleteSteps(jobId)
        upsertSteps(steps)
    }

    @Query("DELETE FROM job_steps WHERE job_id = :jobId")
    suspend fun deleteSteps(jobId: String)
}
