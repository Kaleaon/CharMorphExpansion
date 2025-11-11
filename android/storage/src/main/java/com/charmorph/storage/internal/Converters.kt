package com.charmorph.storage.internal

import androidx.room.TypeConverter
import com.charmorph.core.model.JobState
import com.charmorph.core.model.StepStatus

class Converters {
    @TypeConverter
    fun jobStateToString(value: JobState): String = value.name

    @TypeConverter
    fun stringToJobState(value: String): JobState = JobState.valueOf(value)

    @TypeConverter
    fun stepStatusToString(value: StepStatus): String = value.name

    @TypeConverter
    fun stringToStepStatus(value: String): StepStatus = StepStatus.valueOf(value)
}
