package com.charmorph.storage

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

@Singleton
class SettingsRepository @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        val SHOW_ANATOMICAL_DETAILS = booleanPreferencesKey("show_anatomical_details")
    }

    val showAnatomicalDetails: Flow<Boolean> = context.dataStore.data
        .map { preferences ->
            preferences[SHOW_ANATOMICAL_DETAILS] ?: false
        }

    suspend fun setShowAnatomicalDetails(show: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[SHOW_ANATOMICAL_DETAILS] = show
        }
    }
}
