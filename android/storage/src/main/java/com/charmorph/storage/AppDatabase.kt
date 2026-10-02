package com.charmorph.storage

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.charmorph.storage.dao.CharacterDao
import com.charmorph.storage.entity.CharacterEntity
import com.charmorph.storage.entity.CharacterPayloadEntity

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `character_payloads` (
                `characterId` TEXT NOT NULL,
                `meshData` TEXT NOT NULL,
                `skeletonData` TEXT NOT NULL,
                `morphWeights` TEXT NOT NULL,
                PRIMARY KEY(`characterId`),
                FOREIGN KEY(`characterId`) REFERENCES `characters`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            INSERT INTO `character_payloads` (`characterId`, `meshData`, `skeletonData`, `morphWeights`)
            SELECT `id`, `meshData`, `skeletonData`, `morphWeights` FROM `characters`
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `characters_new` (
                `id` TEXT NOT NULL,
                `name` TEXT NOT NULL,
                `thumbnailPath` TEXT,
                `lastModified` INTEGER NOT NULL,
                PRIMARY KEY(`id`)
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            INSERT INTO `characters_new` (`id`, `name`, `thumbnailPath`, `lastModified`)
            SELECT `id`, `name`, `thumbnailPath`, `lastModified` FROM `characters`
            """.trimIndent()
        )

        db.execSQL("DROP TABLE `characters`")
        db.execSQL("ALTER TABLE `characters_new` RENAME TO `characters`")
    }
}

@Database(
    entities = [CharacterEntity::class, CharacterPayloadEntity::class],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun characterDao(): CharacterDao

    companion object {
        private const val DATABASE_NAME = "charmorph_db"

        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    DATABASE_NAME
                )
                .addMigrations(MIGRATION_1_2)
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
