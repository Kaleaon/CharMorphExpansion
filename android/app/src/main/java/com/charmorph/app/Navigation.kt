package com.charmorph.app

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.charmorph.app.ui.HomeScreen
import com.charmorph.app.ui.ImportScreen
import com.charmorph.feature.photoimport.ui.PhotoImportScreen

@Composable
fun CharMorphNavHost() {
    val navController = rememberNavController()
    
    NavHost(navController = navController, startDestination = "home") {
        composable("home") {
            HomeScreen(
                onImportClick = { navController.navigate("import") },
                onPhotoImportClick = { navController.navigate("photo_import") }
            )
        }
        composable("import") {
            ImportScreen(
                onBack = { navController.popBackStack() }
            )
        }
        composable("photo_import") {
            PhotoImportScreen(
                onBack = { navController.popBackStack() }
            )
        }
    }
}
