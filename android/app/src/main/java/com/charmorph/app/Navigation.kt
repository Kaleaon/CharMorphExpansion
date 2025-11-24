package com.charmorph.app

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.charmorph.app.ui.HomeScreen
import com.charmorph.app.ui.ImportScreen

@Composable
fun CharMorphNavHost() {
    val navController = rememberNavController()
    
    NavHost(navController = navController, startDestination = "home") {
        composable("home") {
            HomeScreen(
                onImportClick = { navController.navigate("import") }
            )
        }
        composable("import") {
            ImportScreen(
                onBack = { navController.popBackStack() }
            )
        }
    }
}
