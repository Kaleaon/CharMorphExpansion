plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "com.charmorph.ml.engine"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
        targetSdk = 34
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":core-model"))
    implementation("androidx.annotation:annotation:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.tensorflow:tensorflow-lite:2.14.0")
}
