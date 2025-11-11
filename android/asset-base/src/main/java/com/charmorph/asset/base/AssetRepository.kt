package com.charmorph.asset.base

import android.content.Context
import com.charmorph.core.model.IngestionJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Provides access to bundled base meshes and metadata packaged with the application.
 *
 * Implementation currently exposes stubs, allowing other modules to compile against
 * a stable API while the ingestion pipeline is brought online.
 */
class AssetRepository(
    private val context: Context,
) {
    private val recentJobs = MutableStateFlow<List<IngestionJob>>(emptyList())

    fun listRecentJobs(): Flow<List<IngestionJob>> = recentJobs

    fun refresh() {
        // TODO: load sample assets from assets/ or raw/ once available.
        recentJobs.value = emptyList()
    }
}
