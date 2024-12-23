#include <jni.h>

extern "C" {
#include "game_core.h"
}

jstring createJString(JNIEnv* env, const char* str) {
    if (str == nullptr) return nullptr;
    return env->NewStringUTF(str);
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
    const char *key_value_storage_path = getCString(keyValueStoragePath);
    const char *localized_strings_path = getCString(localizedStringsPath);

    initialize_config(
            true,
            base_entity_speed,
            current_lang,
            levels_path,
            species_path,
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
    releaseCString(keyValueStoragePath, key_value_storage_path);
    releaseCString(localizedStringsPath, localized_strings_path);
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_initializeGame(JNIEnv *env, jobject thiz) {
    initialize_game(GameMode_RealTimeCoOp);
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
        jfloat renderingScale
) {
    auto width = static_cast<float>(_width);
    auto height = static_cast<float>(_height);
    auto rendering_scale = static_cast<float>(renderingScale);
    window_size_changed(width, height, rendering_scale);
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
        jboolean closeAttackPressed,
        jboolean rangedAttackPressed,
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
    auto close_attack_pressed = static_cast<bool>(closeAttackPressed);
    auto ranged_attack_pressed = static_cast<bool>(rangedAttackPressed);
    auto time_since_last_update = static_cast<float>(timeSinceLastUpdate);

    update_keyboard(
            0,
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
            close_attack_pressed,
            ranged_attack_pressed,
            false,
            false,
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
    return number_of_kunai_in_inventory(0);
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_isNight(JNIEnv *env, jobject thiz) {
    return is_night();
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_isLimitedVisibility(JNIEnv *env, jobject thiz) {
    return is_limited_visibility();
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_isInteractionAvailable(JNIEnv *env, jobject thiz) {
    return is_interaction_available();
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_startNewGame(JNIEnv *env, jobject thiz) {
    start_new_game();
}

extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_currentSoundEffects(JNIEnv *env, jobject thiz) {
    // Step 1: Retrieve native sound effects array and its length
    uintptr_t length = 0;
    SoundEffect* sound_effects = get_current_sound_effects(&length);

    // Step 2: Handle cases where retrieval fails or returns no sound effects
    if (sound_effects == nullptr || length == 0) {
        // Optionally, you can throw an exception or return an empty list
        // Here, we'll return an empty ArrayList

        // Find the ArrayList class
        jclass arrayListClass = env->FindClass("java/util/ArrayList");
        if (arrayListClass == nullptr) {
            // If ArrayList class not found, return null
            return nullptr;
        }

        // Get the constructor ID for ArrayList()
        jmethodID arrayListInit = env->GetMethodID(arrayListClass, "<init>", "()V");
        if (arrayListInit == nullptr) {
            // If constructor not found, return null
            return nullptr;
        }

        // Create a new ArrayList instance
        jobject emptyList = env->NewObject(arrayListClass, arrayListInit);
        return emptyList;
    }

    // Step 3: Find the ArrayList class and its constructor and add method
    jclass arrayListClass = env->FindClass("java/util/ArrayList");
    if (arrayListClass == nullptr) {
        // ArrayList class not found, handle error
        free_sound_effects(sound_effects, length);
        return nullptr;
    }

    // Get the constructor ID for ArrayList()
    jmethodID arrayListInit = env->GetMethodID(arrayListClass, "<init>", "()V");
    if (arrayListInit == nullptr) {
        // Constructor not found, handle error
        free_sound_effects(sound_effects, length);
        return nullptr;
    }

    // Get the add method ID for ArrayList.add(Object)
    jmethodID arrayListAdd = env->GetMethodID(arrayListClass, "add", "(Ljava/lang/Object;)Z");
    if (arrayListAdd == nullptr) {
        // Add method not found, handle error
        free_sound_effects(sound_effects, length);
        return nullptr;
    }

    // Step 4: Find the Integer class and its valueOf(int) static method
    jclass integerClass = env->FindClass("java/lang/Integer");
    if (integerClass == nullptr) {
        // Integer class not found, handle error
        free_sound_effects(sound_effects, length);
        return nullptr;
    }

    // Get the static method ID for Integer.valueOf(int)
    jmethodID integerValueOf = env->GetStaticMethodID(integerClass, "valueOf", "(I)Ljava/lang/Integer;");
    if (integerValueOf == nullptr) {
        // valueOf method not found, handle error
        free_sound_effects(sound_effects, length);
        return nullptr;
    }

    // Step 5: Create a new ArrayList instance
    jobject arrayList = env->NewObject(arrayListClass, arrayListInit);
    if (arrayList == nullptr) {
        // Failed to create ArrayList instance, handle error
        free_sound_effects(sound_effects, length);
        return nullptr;
    }

    // Step 6: Iterate through the native sound effects and populate the Java list
    for (uintptr_t i = 0; i < length; ++i) {
        SoundEffect effect = sound_effects[i];

        // Convert the SoundEffect enum to its integer value
        jint effectValue = static_cast<jint>(effect);

        // Box the integer into a java.lang.Integer object using Integer.valueOf(int)
        jobject integerObject = env->CallStaticObjectMethod(integerClass, integerValueOf, effectValue);

        if (integerObject == nullptr) {
            // Failed to box integer, skip adding to the list
            continue;
        }

        // Add the Integer object to the ArrayList
        jboolean added = env->CallBooleanMethod(arrayList, arrayListAdd, integerObject);

        // Optionally, check if the add operation was successful
        if (added == JNI_FALSE) {
            // Failed to add to the list, handle if necessary
        }

        // Delete local reference to the Integer object to prevent memory leaks
        env->DeleteLocalRef(integerObject);
    }

    // Step 7: Free the native sound effects array
    free_sound_effects(sound_effects, length);

    // Step 8: Return the populated ArrayList
    return arrayList;
}

extern "C"
JNIEXPORT jstring JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_currentSoundTrack(JNIEnv *env, jobject thiz) {
    auto value = current_soundtrack();
    jstring text = env->NewStringUTF(value);
    return text;
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_isSwordEquipped(JNIEnv *env, jobject thiz) {
    return is_melee_equipped(0);
}

extern "C"
JNIEXPORT jfloat JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_playerCurrentHp(JNIEnv *env, jobject thiz) {
    return player_current_hp(0);
}
extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_nextMessage(JNIEnv *env, jobject thiz) {
    CDisplayableMessage msg = next_message_c();

    if (!msg.is_valid) {
        return nullptr;
    }

    // Find the DisplayableMessage class
    jclass displayableMessageClass = env->FindClass("it/curzel/bitscape/gamecore/DisplayableMessage");
    if (displayableMessageClass == nullptr) {
        return nullptr;
    }

    // Get the constructor method ID
    jmethodID constructor = env->GetMethodID(displayableMessageClass, "<init>", "(Ljava/lang/String;Ljava/lang/String;)V");
    if (constructor == nullptr) {
        return nullptr;
    }

    // Create Java Strings for title and text
    jstring title = createJString(env, msg.title);
    jstring text = createJString(env, msg.text);

    // Create the DisplayableMessage object
    jobject displayableMessage = env->NewObject(displayableMessageClass, constructor, title, text);

    // Clean up local references
    env->DeleteLocalRef(title);
    env->DeleteLocalRef(text);
    env->DeleteLocalRef(displayableMessageClass);

    return displayableMessage;
}

extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_nextToast(JNIEnv *env, jobject thiz) {
    CToast toast = next_toast_c();

    if (!toast.is_valid) {
        return nullptr;
    }

    // Find the Toast class
    jclass toastClass = env->FindClass("it/curzel/bitscape/gamecore/DisplayableToast");
    if (toastClass == nullptr) {
        return nullptr;
    }

    // Get the Toast constructor
    jmethodID toastConstructor = env->GetMethodID(toastClass, "<init>", "(Ljava/lang/String;Lit/curzel/bitscape/gamecore/DisplayableToast$Mode;FLit/curzel/bitscape/gamecore/DisplayableToast$Image;)V");
    if (toastConstructor == nullptr) {
        return nullptr;
    }

    // Create Java String for text
    jstring text = createJString(env, toast.text);

    // Map ToastMode enum
    jclass toastModeClass = env->FindClass("it/curzel/bitscape/gamecore/DisplayableToast$Mode");
    if (toastModeClass == nullptr) {
        return nullptr;
    }

    // Assume ToastMode has a static method fromInt(int) to map the enum
    jmethodID fromIntMethod = env->GetStaticMethodID(toastModeClass, "fromInt", "(I)Lit/curzel/bitscape/gamecore/DisplayableToast$Mode;");
    if (fromIntMethod == nullptr) {
        return nullptr;
    }

    jobject toastMode = env->CallStaticObjectMethod(toastModeClass, fromIntMethod, (jint)toast.mode);

    // Handle ToastImage
    jobject toastImage = nullptr;
    if (toast.image.is_valid) {
        // Find the ToastImage class
        jclass toastImageClass = env->FindClass("it/curzel/bitscape/gamecore/DisplayableToast$Image");
        if (toastImageClass == nullptr) {
            return nullptr;
        }

        // Get the ToastImage constructor
        jmethodID toastImageConstructor = env->GetMethodID(toastImageClass, "<init>", "(ILit/curzel/bitscape/gamecore/IntRect;)V");
        if (toastImageConstructor == nullptr) {
            return nullptr;
        }

        // Find the IntRect class
        jclass intRectClass = env->FindClass("it/curzel/bitscape/gamecore/IntRect");
        if (intRectClass == nullptr) {
            return nullptr;
        }

        // Get the IntRect constructor
        jmethodID intRectConstructor = env->GetMethodID(intRectClass, "<init>", "(IIII)V");
        if (intRectConstructor == nullptr) {
            return nullptr;
        }

        // Create IntRect object
        jobject textureFrame = env->NewObject(intRectClass, intRectConstructor,
                                              toast.image.texture_frame.x,
                                              toast.image.texture_frame.y,
                                              toast.image.texture_frame.w,
                                              toast.image.texture_frame.h);

        // Create ToastImage object
        toastImage = env->NewObject(toastImageClass, toastImageConstructor,
                                    (jint)toast.image.sprite_sheet_id,
                                    textureFrame);

        // Clean up local references
        env->DeleteLocalRef(intRectClass);
        env->DeleteLocalRef(textureFrame);
        env->DeleteLocalRef(toastImageClass);
    }

    // Create the Toast object
    jobject toastObject = env->NewObject(toastClass, toastConstructor, text, toastMode, (jfloat)toast.duration, toastImage);

    // Clean up local references
    env->DeleteLocalRef(text);
    env->DeleteLocalRef(toastModeClass);
    env->DeleteLocalRef(toastMode);
    if (toastImage != nullptr) {
        env->DeleteLocalRef(toastImage);
    }
    env->DeleteLocalRef(toastClass);

    return toastObject;
}

extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_matchResult(JNIEnv *env, jobject thiz) {
    CMatchResult result = match_result_c();

    // Find the MatchResult class
    jclass matchResultClass = env->FindClass("it/curzel/bitscape/gamecore/MatchResult");
    if (matchResultClass == nullptr) {
        return nullptr;
    }

    // Get the MatchResult constructor
    jmethodID constructor = env->GetMethodID(matchResultClass, "<init>", "(IZZZ)V");
    if (constructor == nullptr) {
        return nullptr;
    }

    // Create the MatchResult object
    jobject matchResultObject = env->NewObject(matchResultClass, constructor,
                                               (jint)result.winner,
                                               (jboolean)result.unknown_winner,
                                               (jboolean)result.game_over,
                                               (jboolean)result.in_progress);

    // Clean up local references
    env->DeleteLocalRef(matchResultClass);

    return matchResultObject;
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_revive(JNIEnv *env, jobject thiz) {
    revive();
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_hasRequestedFastTravel(JNIEnv *env, jobject thiz) {
    return did_request_fast_travel();
}

extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_fastTravelOptions(JNIEnv *env, jobject thiz) {
    uintptr_t length = 0;
    // Call the C function to get the destinations
    FastTravelDestination *destinations = available_fast_travel_destinations_from_current_world_c(
            &length);

    if (destinations == nullptr || length == 0) {
        // Return an empty jintArray
        return env->NewIntArray(0);
    }

    // Create a jintArray to hold the destinations
    jintArray result = env->NewIntArray(length);
    if (result == nullptr) {
        // Out of memory error thrown
        return nullptr;
    }

    // Temporary buffer to hold the destination values
    jint temp[length];
    for (uintptr_t i = 0; i < length; ++i) {
        temp[i] = static_cast<jint>(destinations[i]);
    }

    // Set the jintArray elements
    env->SetIntArrayRegion(result, 0, length, temp);

    return result;
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_cancelFastTravel(JNIEnv *env, jobject thiz) {
    cancel_fast_travel();
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_handleFastTravel(JNIEnv *env, jobject thiz,
                                                            jint destination) {
    auto dest = static_cast<FastTravelDestination>(destination);

    switch(dest) {
        case FastTravelDestination_Evergrove:
        case FastTravelDestination_Aridreach:
        case FastTravelDestination_Duskhaven:
        case FastTravelDestination_PeakLevel:
        case FastTravelDestination_Maritide:
        case FastTravelDestination_Thermoria:
        case FastTravelDestination_Vintoria:
            handle_fast_travel(dest);
            break;
        default:
            break;
    }}