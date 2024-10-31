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

extern "C"
JNIEXPORT jint JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_numberOfKunaiInInventory(JNIEnv *env, jobject thiz) {
    return number_of_kunai_in_inventory();
}

extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_toastConfig(JNIEnv *env, jobject thiz) {
    ToastDescriptorC toastDescriptor = current_toast();

    jclass toastConfigClass = env->FindClass("it/curzel/bitscape/rendering/ToastConfig");
    if (toastConfigClass == nullptr) {
        return nullptr;
    }

    jmethodID toastConfigConstructor = env->GetMethodID(
            toastConfigClass,
            "<init>",
            "(JFLjava/lang/String;ZLjava/lang/Integer;Lit/curzel/bitscape/gamecore/IntRect;)V"
    );
    if (toastConfigConstructor == nullptr) {
        return nullptr;
    }

    jlong backgroundColorArgb = ((jlong)toastDescriptor.background_color.alpha << 24) |
                                ((jlong)toastDescriptor.background_color.red << 16) |
                                ((jlong)toastDescriptor.background_color.green << 8) |
                                ((jlong)toastDescriptor.background_color.blue);

    jfloat opacity = toastDescriptor.background_color.alpha / 255.0f;
    jstring text = env->NewStringUTF(toastDescriptor.text);
    jboolean isImportant = (toastDescriptor.mode == ToastMode_Important) ? JNI_TRUE : JNI_FALSE;

    jobject spriteSheetId = nullptr;
    if (toastDescriptor.image.sprite_sheet_id != 0) {
        jclass integerClass = env->FindClass("java/lang/Integer");
        if (integerClass != nullptr) {
            jmethodID integerConstructor = env->GetMethodID(integerClass, "<init>", "(I)V");
            if (integerConstructor != nullptr) {
                spriteSheetId = env->NewObject(integerClass, integerConstructor, (jint)toastDescriptor.image.sprite_sheet_id);
            }
        }
    }

    jobject textureFrame = nullptr;
    if (toastDescriptor.image.sprite_sheet_id != 0) {
        jclass intRectClass = env->FindClass("it/curzel/bitscape/gamecore/IntRect");
        if (intRectClass != nullptr) {
            jmethodID intRectConstructor = env->GetMethodID(intRectClass, "<init>", "(IIII)V");
            if (intRectConstructor != nullptr) {
                textureFrame = env->NewObject(intRectClass, intRectConstructor,
                                              (jint)toastDescriptor.image.texture_frame.x,
                                              (jint)toastDescriptor.image.texture_frame.y,
                                              (jint)toastDescriptor.image.texture_frame.w,
                                              (jint)toastDescriptor.image.texture_frame.h);
            }
        }
    }

    jobject toastConfig = env->NewObject(
            toastConfigClass,
            toastConfigConstructor,
            backgroundColorArgb,
            opacity,
            text,
            isImportant,
            spriteSheetId,
            textureFrame
    );

    return toastConfig;
}

extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_menuConfig(JNIEnv *env, jobject thiz) {
    MenuDescriptorC menu = current_menu();

    jclass menuConfigClass = env->FindClass("it/curzel/bitscape/rendering/MenuConfig");
    if (menuConfigClass == nullptr) {
        return nullptr;
    }

    jmethodID menuConfigConstructor = env->GetMethodID(
            menuConfigClass,
            "<init>",
            "(ZLjava/lang/String;Ljava/lang/String;Ljava/util/List;)V"
    );
    if (menuConfigConstructor == nullptr) {
        return nullptr;
    }

    jboolean isVisible = menu.is_visible ? JNI_TRUE : JNI_FALSE;

    jstring title = nullptr;
    if (menu.title != nullptr) {
        title = env->NewStringUTF(menu.title);
    }

    jstring text = nullptr;
    if (menu.text != nullptr) {
        text = env->NewStringUTF(menu.text);
    }

    jclass arrayListClass = env->FindClass("java/util/ArrayList");
    if (arrayListClass == nullptr) {
        return nullptr;
    }

    jmethodID arrayListConstructor = env->GetMethodID(arrayListClass, "<init>", "()V");
    if (arrayListConstructor == nullptr) {
        return nullptr;
    }

    jobject optionsList = env->NewObject(arrayListClass, arrayListConstructor);
    if (optionsList == nullptr) {
        return nullptr;
    }

    jmethodID arrayListAdd = env->GetMethodID(arrayListClass, "add", "(Ljava/lang/Object;)Z");
    if (arrayListAdd == nullptr) {
        return nullptr;
    }

    for (uint32_t i = 0; i < menu.options_count; ++i) {
        const char* optionTitle = menu.options[i].title;
        jstring optionString = env->NewStringUTF(optionTitle);
        env->CallBooleanMethod(optionsList, arrayListAdd, optionString);
        env->DeleteLocalRef(optionString);
    }

    jobject menuConfigObject = env->NewObject(
            menuConfigClass,
            menuConfigConstructor,
            isVisible,
            title,
            text,
            optionsList
    );

    if (title != nullptr) {
        env->DeleteLocalRef(title);
    }
    if (text != nullptr) {
        env->DeleteLocalRef(text);
    }
    env->DeleteLocalRef(optionsList);
    env->DeleteLocalRef(arrayListClass);
    env->DeleteLocalRef(menuConfigClass);

    return menuConfigObject;
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_selectCurrentMenuOptionAtIndex(JNIEnv *env, jobject thiz, jint index) {
    select_current_menu_option_at_index(index);
}

extern "C"
JNIEXPORT jint JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_defaultTileType(JNIEnv *env, jobject thiz) {
    return current_world_default_tile().tile_type;
}