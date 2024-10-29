#include <jni.h>

extern "C" {
    #include "game_core.h"
}

extern "C"
JNIEXPORT jint JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_currentWorldId(JNIEnv *env, jobject thiz) {
    uint32_t id = current_world_id();
    return static_cast<jint>(id);
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_initializeGame(JNIEnv *env, jobject thiz, jboolean creativeMode) {
    bool creative_mode = static_cast<bool>(creativeMode);
    initialize_game(creative_mode);
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_testLogs(JNIEnv *env, jobject thiz) {
    test_logs();
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_testBool(JNIEnv *env, jobject thiz) {
    return test_bool();
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_initializeConfig(
    JNIEnv *env,
    jobject thiz,
    jfloat baseEntitySpeed,
    jstring currentLang,
    jstring levelsPath,
    jstring speciesPath,
    jstring inventoryPath,
    jstring keyValueStoragePath,
    jstring localizedStringsPath
) {
    // Convert jfloat to float
    float base_entity_speed = static_cast<float>(baseEntitySpeed);

    // Helper lambda to convert jstring to const char*
    auto getCString = [&](jstring jStr) -> const char* {
        if (jStr == nullptr) {
            return nullptr;
        }
        return env->GetStringUTFChars(jStr, nullptr);
    };

    // Convert jstrings to C-style strings
    const char* current_lang = getCString(currentLang);
    const char* levels_path = getCString(levelsPath);
    const char* species_path = getCString(speciesPath);
    const char* inventory_path = getCString(inventoryPath);
    const char* key_value_storage_path = getCString(keyValueStoragePath);
    const char* localized_strings_path = getCString(localizedStringsPath);

    // Call the native initialize_config function
    initialize_config(
        base_entity_speed,
        current_lang,
        levels_path,
        species_path,
        inventory_path,
        key_value_storage_path,
        localized_strings_path
    );

    // Release the C-style strings
    auto releaseCString = [&](jstring jStr, const char* cStr) {
        if (jStr != nullptr && cStr != nullptr) {
            env->ReleaseStringUTFChars(jStr, cStr);
        }
    };

    releaseCString(currentLang, current_lang);
    releaseCString(levelsPath, levels_path);
    releaseCString(speciesPath, species_path);
    releaseCString(inventoryPath, inventory_path);
    releaseCString(keyValueStoragePath, key_value_storage_path);
    releaseCString(localizedStringsPath, localized_strings_path);
}