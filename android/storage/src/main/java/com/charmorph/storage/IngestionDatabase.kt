package com.charmorph.storage

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.charmorph.storage.dao.JobDao
import com.charmorph.storage.entities.JobEntity
import com.charmorph.storage.entities.JobStepEntity
import com.charmorph.storage.internal.Converters

@Database(
    entities = [JobEntity::class, JobStepEntity::class],
    version = 1,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class IngestionDatabase : RoomDatabase() {
    abstract fun jobDao(): JobDao
}
