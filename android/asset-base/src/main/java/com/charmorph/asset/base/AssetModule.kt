package com.charmorph.asset.base

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AssetModule {
    @Provides
    @Singleton
    fun provideAssetRepository(
        @ApplicationContext context: Context,
    ): AssetRepository = AssetRepository(context)

    @Provides
    @Singleton
    fun provideSkeletonAssetManager(
        @ApplicationContext context: Context,
    ): SkeletonAssetManager = SkeletonAssetManager(context)
}
