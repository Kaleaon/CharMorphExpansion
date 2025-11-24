package com.charmorph.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onImportClick: () -> Unit,
    onPhotoImportClick: () -> Unit,
    onSettingsClick: () -> Unit,
    onCharacterClick: (String) -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("CharMorph Library") },
                actions = {
                    IconButton(onClick = onSettingsClick) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                }
            )
        },
        floatingActionButton = {
            Column(horizontalAlignment = Alignment.End) {
                SmallFloatingActionButton(
                    onClick = onPhotoImportClick,
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer
                ) {
                    Icon(Icons.Default.Face, contentDescription = "Photo Import")
                }
                Spacer(modifier = Modifier.height(16.dp))
                FloatingActionButton(onClick = onImportClick) {
                    Icon(Icons.Default.Add, contentDescription = "Import Character")
                }
            }
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Welcome to CharMorph", style = MaterialTheme.typography.titleMedium)
                        Text("No characters imported yet.", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            items(5) { index ->
                CharacterListItem(index, onCharacterClick)
            }
        }
    }
}

@Composable
fun CharacterListItem(index: Int, onClick: (String) -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick(index.toString()) }
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Character #$index", style = MaterialTheme.typography.titleMedium)
            Text("Last modified: Today", style = MaterialTheme.typography.bodySmall)
        }
    }
}
