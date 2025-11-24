#include <jni.h>
#include <string>
#include <vector>
#include <android/log.h>

// Placeholder for Eigen includes
// #include <Eigen/Dense>

#define LOG_TAG "CharMorphNative"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

extern "C" JNIEXPORT jstring JNICALL
Java_com_charmorph_nativebridge_NativeLib_stringFromJNI(
        JNIEnv* env,
        jobject /* this */) {
    std::string hello = "Hello from C++";
    return env->NewStringUTF(hello.c_str());
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_charmorph_nativebridge_NativeLib_solveMorphWeights(
        JNIEnv* env,
        jobject /* this */,
        jfloatArray landmarks,
        jfloatArray baseVertices,
        jintArray morphIndices,
        jfloatArray morphDeltas) {
    
    LOGI("Starting morph weight solver...");
    
    // 1. Convert JNI arrays to C++ vectors
    jsize landmarkCount = env->GetArrayLength(landmarks);
    jfloat* landmarkData = env->GetFloatArrayElements(landmarks, 0);
    
    // Mock Solver Logic:
    // In reality, we would build the matrix system A * x = b here.
    // A = Morph Deltas projected to 2D
    // b = Landmark positions - Base Mesh projected positions
    // x = weights (unknowns)
    
    // For now, return a dummy weight array of size 10
    int morphCount = 10; 
    std::vector<float> resultWeights(morphCount, 0.5f); // Default to 0.5
    
    jfloatArray result = env->NewFloatArray(morphCount);
    env->SetFloatArrayRegion(result, 0, morphCount, resultWeights.data());
    
    env->ReleaseFloatArrayElements(landmarks, landmarkData, 0);
    
    LOGI("Solver completed.");
    return result;
}
