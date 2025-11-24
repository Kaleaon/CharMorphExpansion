package com.charmorph.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.charmorph.renderer.FilamentView

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(
    onBack: () -> Unit,
    viewModel: EditorViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val mesh = viewModel.getCharacterMesh()
    
    // Categories derived from morphs
    val categories = remember(uiState.morphs) {
        uiState.morphs.map { it.category }.distinct().sorted()
    }
    
    // Filtered morphs for active category
    val activeMorphs = remember(uiState.morphs, uiState.activeCategory) {
        uiState.morphs.filter { it.category == uiState.activeCategory }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Character Editor") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(modifier = Modifier.padding(paddingValues).fillMaxSize()) {
            // 3D Viewport (taking upper half)
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(Color.DarkGray)
            ) {
                 if (mesh != null) {
                     AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { context ->
                            FilamentView(context).apply {
                                loadMesh(mesh)
                            }
                        },
                        update = { view ->
                            // Apply all current morph weights
                            uiState.morphs.forEach { morph ->
                                 view.updateMorphWeight(morph.name, morph.value)
                            }
                        }
                     )
                 } else {
                     Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                         CircularProgressIndicator()
                     }
                 }
            }

            // Controls (taking lower half)
            Surface(
                modifier = Modifier.weight(1f),
                tonalElevation = 2.dp
            ) {
                Column {
                    // Category Tabs
                    ScrollableTabRow(
                        selectedTabIndex = categories.indexOf(uiState.activeCategory).coerceAtLeast(0),
                        edgePadding = 16.dp
                    ) {
                        categories.forEach { category ->
                            Tab(
                                selected = category == uiState.activeCategory,
                                onClick = { viewModel.setCategory(category) },
                                text = { Text(category) }
                            )
                        }
                    }

                    // Sliders List
                    LazyColumn(
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        items(activeMorphs) { morph ->
                            MorphSlider(
                                morph = morph,
                                onValueChange = { viewModel.updateMorph(morph.name, it) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun MorphSlider(
    morph: MorphState,
    onValueChange: (Float) -> Unit
) {
    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = morph.displayName, style = MaterialTheme.typography.bodyMedium)
            Text(text = "%.2f".format(morph.value), style = MaterialTheme.typography.bodySmall)
        }
        Slider(
            value = morph.value,
            onValueChange = onValueChange,
            valueRange = morph.min..morph.max
        )
    }
}
