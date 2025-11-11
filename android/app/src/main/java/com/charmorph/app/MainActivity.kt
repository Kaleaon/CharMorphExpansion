package com.charmorph.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.charmorph.app.ui.theme.CharMorphTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            CharMorphTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    MainScreen()
                }
            }
        }
    }
}

@Composable
fun MainScreen(viewModel: MainViewModel = hiltViewModel()) {
    val state by viewModel.downloadState.collectAsState()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = "CharMorph Android – ingestion prototype",
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = "Download the canonical human skeleton STL bundle provided by Artec3D. " +
                "This large asset is cached locally for future runs.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Button(
            onClick = { viewModel.downloadSkeleton() },
            enabled = state !is MainViewModel.DownloadState.Loading,
        ) {
            Text("Fetch human skeleton asset")
        }
        when (state) {
            MainViewModel.DownloadState.Idle -> {
                Text(
                    text = "Asset not downloaded yet.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            MainViewModel.DownloadState.Loading -> {
                CircularProgressIndicator()
                Text(
                    text = "Downloading… this may take a while due to file size.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            is MainViewModel.DownloadState.Success -> {
                Text(
                    text = "Download complete: ${(state as MainViewModel.DownloadState.Success).path}",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            is MainViewModel.DownloadState.Error -> {
                Text(
                    text = "Error: ${(state as MainViewModel.DownloadState.Error).message}",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

