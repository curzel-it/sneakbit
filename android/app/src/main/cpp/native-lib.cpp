#include <jni.h>

extern "C" {
    #include "game_core.h"
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
    auto base_entity_speed = static_cast<float>(baseEntitySpeed);

    auto getCString = [&](jstring jStr) -> const char* {
        if (jStr == nullptr) {
            return nullptr;
        }
        return env->GetStringUTFChars(jStr, nullptr);
    };

    const char* current_lang = getCString(currentLang);
    const char* levels_path = getCString(levelsPath);
    const char* species_path = getCString(speciesPath);
    const char* inventory_path = getCString(inventoryPath);
    const char* key_value_storage_path = getCString(keyValueStoragePath);
    const char* localized_strings_path = getCString(localizedStringsPath);

    initialize_config(
        base_entity_speed,
        current_lang,
        levels_path,
        species_path,
        inventory_path,
        key_value_storage_path,
        localized_strings_path
    );

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

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_initializeGame(JNIEnv *env, jobject thiz, jboolean creativeMode) {
    bool creative_mode = static_cast<bool>(creativeMode);
    initialize_game(creative_mode);
}

extern "C"
JNIEXPORT jint JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_currentWorldId(JNIEnv *env, jobject thiz) {
    return static_cast<jint>(current_world_id());
}

extern "C"
JNIEXPORT jint JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_currentWorldWidth(JNIEnv *env, jobject thiz) {
    return static_cast<jint>(current_world_width());
}

extern "C"
JNIEXPORT jint JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_currentWorldHeight(JNIEnv *env, jobject thiz) {
    return static_cast<jint>(current_world_height());
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_windowSizeChanged(
    JNIEnv *env,
    jobject thiz,
    jfloat _width,
    jfloat _height,
    jfloat renderingScale,
    jfloat fontSize,
    jfloat lineSpacing
) {
    auto width = static_cast<float>(_width);
    auto height = static_cast<float>(_height);
    auto rendering_scale = static_cast<float>(renderingScale);
    auto font_size = static_cast<float>(fontSize);
    auto line_spacing = static_cast<float>(lineSpacing);
    window_size_changed(width, height, rendering_scale, font_size, line_spacing);
}
extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_updateKeyboard(
    JNIEnv *env,
    jobject thiz,
    jboolean upPressed,
    jboolean rightPressed,
    jboolean downPressed,
    jboolean leftPressed,
    jboolean upDown,
    jboolean rightDown,
    jboolean downDown,
    jboolean leftDown,
    jboolean escapePressed,
    jboolean menuPressed,
    jboolean confirmPressed,
    jboolean attackPressed,
    jboolean backspacePressed,
    jint currentChar,
    jfloat timeSinceLastUpdate
) {
    auto up_pressed = static_cast<bool>(upPressed);
    auto right_pressed = static_cast<bool>(rightPressed);
    auto down_pressed = static_cast<bool>(downPressed);
    auto left_pressed = static_cast<bool>(leftPressed);
    auto up_down = static_cast<bool>(upDown);
    auto right_down = static_cast<bool>(rightDown);
    auto down_down = static_cast<bool>(downDown);
    auto left_down = static_cast<bool>(leftDown);
    auto escape_pressed = static_cast<bool>(escapePressed);
    auto menu_pressed = static_cast<bool>(menuPressed);
    auto confirm_pressed = static_cast<bool>(confirmPressed);
    auto attack_pressed = static_cast<bool>(attackPressed);
    auto backspace_pressed = static_cast<bool>(backspacePressed);
    auto current_char = static_cast<uint32_t>(currentChar);
    auto time_since_last_update = static_cast<float>(timeSinceLastUpdate);

    update_keyboard(
        up_pressed,
        right_pressed,
        down_pressed,
        left_pressed,
        up_down,
        right_down,
        down_down,
        left_down,
        escape_pressed,
        menu_pressed,
        confirm_pressed,
        attack_pressed,
        backspace_pressed,
        current_char,
        time_since_last_update
    );
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_updateGame(
    JNIEnv *env,
    jobject thiz,
    jfloat timeSinceLastUpdate
) {
    auto time_since_last_update = static_cast<float>(timeSinceLastUpdate);
    update_game(time_since_last_update);
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_showsDeathScreen(JNIEnv *env, jobject thiz) {
    return shows_death_screen();
}

extern "C"
JNIEXPORT jint JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_currentBiomeTilesVariant(JNIEnv *env, jobject thiz) {
    return current_biome_tiles_variant();
}

extern "C"
JNIEXPORT jintArray JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_cameraViewport(JNIEnv *env, jobject thiz) {
    auto viewport = camera_viewport();
    jintArray result = env->NewIntArray(4);
    if (result == nullptr) {
        return nullptr;
    }

    jint temp[4];
    temp[0] = viewport.x;
    temp[1] = viewport.y;
    temp[2] = viewport.w;
    temp[3] = viewport.h;

    env->SetIntArrayRegion(result, 0, 4, temp);
    return result;
}

extern "C"
JNIEXPORT jfloatArray JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_cameraViewportOffset(JNIEnv *env, jobject thiz) {
    auto offset = camera_viewport_offset();
    jfloatArray result = env->NewFloatArray(2);
    if (result == nullptr) {
        return nullptr;
    }

    jfloat temp[2];
    temp[0] = offset.x;
    temp[1] = offset.y;

    env->SetFloatArrayRegion(result, 0, 2, temp);
    return result;
}

extern "C"
JNIEXPORT jint JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_currentWorldRevision(JNIEnv *env, jobject thiz) {
    return current_world_revision();
}