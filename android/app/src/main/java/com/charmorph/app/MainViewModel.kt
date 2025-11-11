package com.charmorph.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.charmorph.asset.base.SkeletonAssetManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    private val skeletonAssetManager: SkeletonAssetManager,
) : ViewModel() {

    private val _downloadState = MutableStateFlow<DownloadState>(DownloadState.Idle)
    val downloadState: StateFlow<DownloadState> = _downloadState.asStateFlow()

    fun downloadSkeleton() {
        if (_downloadState.value is DownloadState.Loading) return
        viewModelScope.launch {
            _downloadState.value = DownloadState.Loading
            runCatching {
                val dir = skeletonAssetManager.ensureSkeletonPresent()
                DownloadState.Success(dir.absolutePath)
            }.onSuccess {
                _downloadState.value = it
            }.onFailure { throwable ->
                _downloadState.value = DownloadState.Error(
                    throwable.message ?: "Unknown failure downloading skeleton asset",
                )
            }
        }
    }

    sealed interface DownloadState {
        data object Idle : DownloadState
        data object Loading : DownloadState
        data class Success(val path: String) : DownloadState
        data class Error(val message: String) : DownloadState
    }
}
