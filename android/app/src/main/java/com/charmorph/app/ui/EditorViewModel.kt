package com.charmorph.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MorphState(
    val name: String,
    val displayName: String,
    val category: String,
    val value: Float = 0f,
    val min: Float = 0f,
    val max: Float = 1f
)

data class EditorUiState(
    val morphs: List<MorphState> = emptyList(),
    val activeCategory: String = "Body"
)

@HiltViewModel
class EditorViewModel @Inject constructor() : ViewModel() {

    private val _uiState = MutableStateFlow(EditorUiState())
    val uiState: StateFlow<EditorUiState> = _uiState.asStateFlow()

    init {
        // Mock data for now. Real data would come from the loaded Character/Mesh.
        val mockMorphs = listOf(
            MorphState("body_fat", "Fatness", "Body"),
            MorphState("body_muscle", "Muscle", "Body"),
            MorphState("arm_length", "Arm Length", "Body"),
            MorphState("leg_length", "Leg Length", "Body"),
            MorphState("face_width", "Face Width", "Face"),
            MorphState("nose_size", "Nose Size", "Face"),
            MorphState("lips_thickness", "Lips Thickness", "Face"),
            MorphState("anatomical_detail_1", "Detail Size", "Genitalia", min=0f, max=2f)
        )
        _uiState.value = EditorUiState(morphs = mockMorphs)
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
        }
    }
}
