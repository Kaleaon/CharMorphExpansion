package com.charmorph.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(onImportClick: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(title = { Text("CharMorph Library") })
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onImportClick) {
                Icon(Icons.Default.Add, contentDescription = "Import Character")
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
                        Text("No characters imported yet. Tap + to start.", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            // Placeholder for list items
            items(5) { index ->
                CharacterListItem(index)
            }
        }
    }
}

@Composable
fun CharacterListItem(index: Int) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Character #$index", style = MaterialTheme.typography.titleMedium)
            Text("Last modified: Today", style = MaterialTheme.typography.bodySmall)
        }
    }
}
