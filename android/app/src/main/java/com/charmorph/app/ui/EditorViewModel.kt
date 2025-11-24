package com.charmorph.app.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.charmorph.core.model.Character
import com.charmorph.storage.CharacterRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// MorphState and EditorUiState defined in previous turn

@HiltViewModel
class EditorViewModel @Inject constructor(
    private val repository: CharacterRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val characterId: String = checkNotNull(savedStateHandle["characterId"])
    
    private val _uiState = MutableStateFlow(EditorUiState())
    val uiState: StateFlow<EditorUiState> = _uiState.asStateFlow()

    private var currentCharacter: Character? = null

    init {
        loadCharacter()
    }

    private fun loadCharacter() {
        viewModelScope.launch {
            val character = repository.getCharacter(characterId)
            if (character != null) {
                currentCharacter = character
                
                // In a real app, we would derive available morphs from the character data (asset files)
                // For now, we'll merge the mock list with active values
                
                val activeWeights = character.activeMorphs
                val morphs = getAvailableMorphs().map { morph ->
                    morph.copy(value = activeWeights[morph.name] ?: morph.value)
                }
                
                _uiState.value = _uiState.value.copy(morphs = morphs)
            }
        }
    }

    fun setCategory(category: String) {
        _uiState.value = _uiState.value.copy(activeCategory = category)
    }

    fun updateMorph(name: String, value: Float) {
        val currentMorphs = _uiState.value.morphs.toMutableList()
        val index = currentMorphs.indexOfFirst { it.name == name }
        if (index != -1) {
            currentMorphs[index] = currentMorphs[index].copy(value = value)
            _uiState.value = _uiState.value.copy(morphs = currentMorphs)
            
            // Auto-save on change (debounce would be better in prod)
            saveCurrentState()
        }
    }
    
    private fun saveCurrentState() {
        viewModelScope.launch {
            val weights = _uiState.value.morphs.associate { it.name to it.value }
            repository.updateMorphWeights(characterId, weights)
        }
    }
    
    fun getCharacterMesh() = currentCharacter?.baseMesh

    private fun getAvailableMorphs(): List<MorphState> {
        // This should eventually come from a "MorphDefinition" asset associated with the character
        return listOf(
            MorphState("body_fat", "Fatness", "Body"),
            MorphState("body_muscle", "Muscle", "Body"),
            MorphState("arm_length", "Arm Length", "Body"),
            MorphState("leg_length", "Leg Length", "Body"),
            MorphState("face_width", "Face Width", "Face"),
            MorphState("nose_size", "Nose Size", "Face"),
            MorphState("lips_thickness", "Lips Thickness", "Face"),
            MorphState("genital_size", "Size", "Genitalia", min=0f, max=2f),
            MorphState("breast_size", "Breast Size", "Body", min=0f, max=2f)
        )
    }
}
