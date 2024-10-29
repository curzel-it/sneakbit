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

    auto getCString = [&](jstring jStr) -> const char * {
        if (jStr == nullptr) {
            return nullptr;
        }
        return env->GetStringUTFChars(jStr, nullptr);
    };

    const char *current_lang = getCString(currentLang);
    const char *levels_path = getCString(levelsPath);
    const char *species_path = getCString(speciesPath);
    const char *inventory_path = getCString(inventoryPath);
    const char *key_value_storage_path = getCString(keyValueStoragePath);
    const char *localized_strings_path = getCString(localizedStringsPath);

    initialize_config(
            base_entity_speed,
            current_lang,
            levels_path,
            species_path,
            inventory_path,
            key_value_storage_path,
            localized_strings_path
    );

    auto releaseCString = [&](jstring jStr, const char *cStr) {
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
Java_it_curzel_bitscape_gamecore_NativeLib_initializeGame(JNIEnv *env, jobject thiz,
                                                          jboolean creativeMode) {
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

extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_fetchUpdatedTiles(
        JNIEnv *env,
        jobject thiz,
        jint world_id
) {
    const BiomeTile *biome_tiles = nullptr;
    const ConstructionTile *construction_tiles = nullptr;
    uintptr_t out_len_x = 0;
    uintptr_t out_len_y = 0;

    uint32_t current_revision = updated_tiles(
            static_cast<uint32_t>(world_id),
            &biome_tiles,
            &construction_tiles,
            &out_len_x,
            &out_len_y
    );

    if (!biome_tiles || !construction_tiles) {
        return nullptr;
    }

    jclass updatedTilesClass = env->FindClass("it/curzel/bitscape/gamecore/UpdatedTiles");
    jclass biomeTileClass = env->FindClass("it/curzel/bitscape/gamecore/BiomeTile");
    jclass constructionTileClass = env->FindClass("it/curzel/bitscape/gamecore/ConstructionTile");
    jclass intRectClass = env->FindClass("it/curzel/bitscape/gamecore/IntRect");

    if (!updatedTilesClass || !biomeTileClass || !constructionTileClass || !intRectClass) {
        return nullptr;
    }

    jmethodID biomeTileConstructor = env->GetMethodID(biomeTileClass, "<init>", "(III)V");
    jmethodID intRectConstructor = env->GetMethodID(intRectClass, "<init>", "(IIII)V");
    jmethodID constructionTileConstructor = env->GetMethodID(constructionTileClass, "<init>",
                                                             "(ILit/curzel/bitscape/gamecore/IntRect;)V");
    jmethodID updatedTilesConstructor = env->GetMethodID(updatedTilesClass, "<init>",
                                                         "(I[[Lit/curzel/bitscape/gamecore/BiomeTile;[[Lit/curzel/bitscape/gamecore/ConstructionTile;)V");

    if (!biomeTileConstructor || !intRectConstructor || !constructionTileConstructor ||
        !updatedTilesConstructor) {
        return nullptr;
    }

    jclass biomeTileArrayClass = env->FindClass("[Lit/curzel/bitscape/gamecore/BiomeTile;");
    jclass constructionTileArrayClass = env->FindClass(
            "[Lit/curzel/bitscape/gamecore/ConstructionTile;");

    if (!biomeTileArrayClass || !constructionTileArrayClass) {
        return nullptr;
    }

    jobjectArray biomeTilesOuterArray = env->NewObjectArray(out_len_y, biomeTileArrayClass,
                                                            nullptr);
    jobjectArray constructionTilesOuterArray = env->NewObjectArray(out_len_y,
                                                                   constructionTileArrayClass,
                                                                   nullptr);

    if (!biomeTilesOuterArray || !constructionTilesOuterArray) {
        return nullptr;
    }

    for (uintptr_t y = 0; y < out_len_y; ++y) {
        jobjectArray biomeTileRow = env->NewObjectArray(out_len_x, biomeTileClass, nullptr);
        jobjectArray constructionTileRow = env->NewObjectArray(out_len_x, constructionTileClass,
                                                               nullptr);

        if (!biomeTileRow || !constructionTileRow) {
            return nullptr;
        }

        for (uintptr_t x = 0; x < out_len_x; ++x) {
            uintptr_t index = y * out_len_x + x;

            const BiomeTile &tile = biome_tiles[index];
            jobject biomeTileObj = env->NewObject(
                    biomeTileClass,
                    biomeTileConstructor,
                    static_cast<jint>(tile.tile_type),
                    static_cast<jint>(tile.texture_offset_x),
                    static_cast<jint>(tile.texture_offset_y)
            );
            if (!biomeTileObj) {
                return nullptr;
            }
            env->SetObjectArrayElement(biomeTileRow, x, biomeTileObj);
            env->DeleteLocalRef(biomeTileObj);

            const ConstructionTile &ctile = construction_tiles[index];
            const IntRect &rect = ctile.texture_source_rect;
            jobject intRectObj = env->NewObject(
                    intRectClass,
                    intRectConstructor,
                    static_cast<jint>(rect.x),
                    static_cast<jint>(rect.y),
                    static_cast<jint>(rect.w),
                    static_cast<jint>(rect.h)
            );
            if (!intRectObj) {
                return nullptr;
            }
            jobject constructionTileObj = env->NewObject(
                    constructionTileClass,
                    constructionTileConstructor,
                    static_cast<jint>(ctile.tile_type),
                    intRectObj
            );
            env->DeleteLocalRef(intRectObj);
            if (!constructionTileObj) {
                return nullptr;
            }
            env->SetObjectArrayElement(constructionTileRow, x, constructionTileObj);
            env->DeleteLocalRef(constructionTileObj);
        }

        env->SetObjectArrayElement(biomeTilesOuterArray, y, biomeTileRow);
        env->DeleteLocalRef(biomeTileRow);

        env->SetObjectArrayElement(constructionTilesOuterArray, y, constructionTileRow);
        env->DeleteLocalRef(constructionTileRow);
    }

    jobject updatedTilesObj = env->NewObject(
            updatedTilesClass,
            updatedTilesConstructor,
            static_cast<jint>(current_revision),
            biomeTilesOuterArray,
            constructionTilesOuterArray
    );

    env->DeleteLocalRef(biomeTilesOuterArray);
    env->DeleteLocalRef(constructionTilesOuterArray);

    return updatedTilesObj;
}

extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_fetchRenderableItems(JNIEnv *env, jobject thiz) {
    uintptr_t length;
    RenderableItem *items = get_renderables(&length);

    jclass intRectClass = env->FindClass("it/curzel/bitscape/gamecore/IntRect");
    jclass vector2dClass = env->FindClass("it/curzel/bitscape/gamecore/Vector2d");
    jclass renderableItemClass = env->FindClass("it/curzel/bitscape/gamecore/RenderableItem");
    jclass arrayListClass = env->FindClass("java/util/ArrayList");

    jmethodID intRectConstructor = env->GetMethodID(intRectClass, "<init>", "(IIII)V");
    jmethodID vector2dConstructor = env->GetMethodID(vector2dClass, "<init>", "(FF)V");
    jmethodID renderableItemConstructor = env->GetMethodID(
            renderableItemClass,
            "<init>",
            "(ILit/curzel/bitscape/gamecore/IntRect;Lit/curzel/bitscape/gamecore/Vector2d;Lit/curzel/bitscape/gamecore/IntRect;)V"
    );
    jmethodID arrayListConstructor = env->GetMethodID(arrayListClass, "<init>", "()V");
    jmethodID arrayListAddMethod = env->GetMethodID(arrayListClass, "add", "(Ljava/lang/Object;)Z");

    jobject arrayListObject = env->NewObject(arrayListClass, arrayListConstructor);

    for (uintptr_t i = 0; i < length; ++i) {
        RenderableItem item = items[i];

        jobject textureRectObject = env->NewObject(
                intRectClass,
                intRectConstructor,
                item.texture_rect.x,
                item.texture_rect.y,
                item.texture_rect.w,
                item.texture_rect.h
        );

        jobject frameObject = env->NewObject(
                intRectClass,
                intRectConstructor,
                item.frame.x,
                item.frame.y,
                item.frame.w,
                item.frame.h
        );

        jobject offsetObject = env->NewObject(
                vector2dClass,
                vector2dConstructor,
                item.offset.x,
                item.offset.y
        );

        jclass uIntClass = env->FindClass("kotlin/UInt");
        jmethodID uIntConstructor = env->GetStaticMethodID(uIntClass, "constructor-impl", "(I)I");
        jint spriteSheetIdUInt = env->CallStaticIntMethod(uIntClass, uIntConstructor,
                                                          (jint) item.sprite_sheet_id);

        jobject renderableItemObject = env->NewObject(
                renderableItemClass,
                renderableItemConstructor,
                spriteSheetIdUInt,
                textureRectObject,
                offsetObject,
                frameObject
        );

        env->CallBooleanMethod(arrayListObject, arrayListAddMethod, renderableItemObject);

        env->DeleteLocalRef(textureRectObject);
        env->DeleteLocalRef(frameObject);
        env->DeleteLocalRef(offsetObject);
        env->DeleteLocalRef(renderableItemObject);
    }

    free_renderables(items, length);
    return arrayListObject;
}