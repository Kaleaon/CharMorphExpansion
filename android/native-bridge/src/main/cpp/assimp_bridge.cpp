#include <jni.h>
#include <string>

extern "C"
JNIEXPORT jstring JNICALL
Java_com_charmorph_native_bridge_NativeBridge_sampleSummary(
        JNIEnv *env,
        jobject /* this */) {
    std::string summary = "Native bridge placeholder - Assimp integration pending.";
    return env->NewStringUTF(summary.c_str());
}
