package com.charmorph.storage

import android.content.Context
import androidx.room.Room
import com.charmorph.storage.dao.JobDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object StorageModule {
    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): IngestionDatabase {
        return Room.databaseBuilder(
            context,
            IngestionDatabase::class.java,
            "ingestion.db",
        ).fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    fun provideJobDao(database: IngestionDatabase): JobDao = database.jobDao()
}
