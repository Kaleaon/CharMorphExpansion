package com.charmorph.ingest.pipeline

import android.content.Context
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import androidx.work.ExistingWorkPolicy
import androidx.work.WorkManager
import com.charmorph.core.model.IngestionJob
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Entry-point for scheduling ingestion sequences. Eventually this will construct
 * a chain of workers that mirror the high-level ingestion design. For now it
 * exposes a compile-time-safe stub so UI code can trigger requests.
 */
@Singleton
class IngestionWorkCoordinator @Inject constructor(
    @ApplicationContext private val context: Context,
    private val workerFactory: HiltWorkerFactory,
) : Configuration.Provider {

    private val workManager by lazy { WorkManager.getInstance(context) }

    fun enqueue(job: IngestionJob) {
        // TODO: build SequentialWork chain when workers land.
        workManager.enqueueUniqueWork(
            "ingest-${job.id}",
            ExistingWorkPolicy.REPLACE,
            emptyList(),
        )
    }

    override fun getWorkManagerConfiguration(): Configuration {
        return Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()
    }
}
