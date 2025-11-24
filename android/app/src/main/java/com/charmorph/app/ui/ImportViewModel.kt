package com.charmorph.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.charmorph.asset.TestAssetGenerator
import com.charmorph.core.model.Character
import com.charmorph.core.model.Skeleton
import com.charmorph.storage.CharacterRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class ImportViewModel @Inject constructor(
    private val repository: CharacterRepository
) : ViewModel() {

    fun importTestCharacter() {
        viewModelScope.launch {
            val mesh = TestAssetGenerator.createCubeMesh()
            val character = Character(
                id = UUID.randomUUID().toString(),
                baseMesh = mesh,
                skeleton = Skeleton(emptyList()), // Dummy skeleton
                activeMorphs = mapOf(
                    "body_fat" to 0.5f,
                    "genital_size" to 1.0f
                )
            )
            repository.saveCharacter(character)
        }
    }
}
