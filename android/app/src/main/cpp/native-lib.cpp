#include <jni.h>

extern "C" {
#include "game_core.h"
}

static jstring toJavaString(JNIEnv *env, const char *cStr) {
    if (cStr == nullptr) {
        return nullptr;
    }
    return env->NewStringUTF(cStr);
}

// Forward declarations for helper functions
jobject createDisplayableToast(JNIEnv *env, const struct CToast &toast);
jobject createDisplayableMessage(JNIEnv *env, const struct CDisplayableMessage &message);
jobject createMatchResult(JNIEnv *env, const struct CMatchResult &matchResult);

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
        jint player,
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
    update_keyboard(
        player,
        upPressed,
        rightPressed,
        downPressed,
        leftPressed,
        upDown,
        rightDown,
        downDown,
        leftDown,
        escapePressed,
        menuPressed,
        confirmPressed,
        closeAttackPressed,
        rangedAttackPressed,
        false,
        false,
        timeSinceLastUpdate
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
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_fetchRenderableItems(JNIEnv *env, jobject thiz) {
    uintptr_t length;
    RenderableItem *items = get_renderables(&length);

    jclass FRectClass = env->FindClass("it/curzel/bitscape/gamecore/FRect");
    jclass vector2dClass = env->FindClass("it/curzel/bitscape/gamecore/Vector2d");
    jclass renderableItemClass = env->FindClass("it/curzel/bitscape/gamecore/RenderableItem");
    jclass arrayListClass = env->FindClass("java/util/ArrayList");

    jmethodID FRectConstructor = env->GetMethodID(FRectClass, "<init>", "(IIII)V");
    jmethodID vector2dConstructor = env->GetMethodID(vector2dClass, "<init>", "(FF)V");
    jmethodID renderableItemConstructor = env->GetMethodID(
            renderableItemClass,
            "<init>",
            "(ILit/curzel/bitscape/gamecore/FRect;Lit/curzel/bitscape/gamecore/Vector2d;Lit/curzel/bitscape/gamecore/FRect;)V"
    );
    jmethodID arrayListConstructor = env->GetMethodID(arrayListClass, "<init>", "()V");
    jmethodID arrayListAddMethod = env->GetMethodID(arrayListClass, "add", "(Ljava/lang/Object;)Z");

    jobject arrayListObject = env->NewObject(arrayListClass, arrayListConstructor);

    for (uintptr_t i = 0; i < length; ++i) {
        RenderableItem item = items[i];

        jobject textureRectObject = env->NewObject(
                FRectClass,
                FRectConstructor,
                item.texture_rect.x,
                item.texture_rect.y,
                item.texture_rect.w,
                item.texture_rect.h
        );

        jobject frameObject = env->NewObject(
                FRectClass,
                FRectConstructor,
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
JNIEXPORT jfloat JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_playerCurrentHp(JNIEnv *env, jobject thiz, jint player) {
    return player_current_hp(player);
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
JNIEXPORT jintArray JNICALL
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
    }
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_hasRequestedPvpArena(JNIEnv *env, jobject thiz) {
    return did_request_pvp_arena();
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_handlePvpArena(JNIEnv *env, jobject thiz, jint number_of_players) {
    handle_pvp_arena(number_of_players);
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_cancelPvpArenaRequest(JNIEnv *env, jobject thiz) {
    cancel_pvp_arena_request();
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_exitPvpArena(JNIEnv *env, jobject thiz) {
    exit_pvp_arena();
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_isPvp(JNIEnv *env, jobject thiz) {
    return is_pvp();
}

extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_gameState(JNIEnv *env, jobject thiz) {
    // 1. Call your native C function to get the current GameState struct
    struct GameState cState = game_state();

    // 2. Convert the C struct fields into the corresponding Java objects

    // 2a. Convert CToast -> DisplayableToast? (null if is_valid == false)
    jobject jToast = nullptr;
    if (cState.toasts.is_valid) {
        jToast = createDisplayableToast(env, cState.toasts);
    }

    // 2b. Convert CDisplayableMessage -> DisplayableMessage? (null if is_valid == false)
    jobject jMessage = nullptr;
    if (cState.messages.is_valid) {
        jMessage = createDisplayableMessage(env, cState.messages);
    }

    // 2c. Convert CMatchResult -> MatchResult
    jobject jMatchResult = createMatchResult(env, cState.match_result);

    // 3. Look up the Kotlin GameState class and its constructor
    //    Signature must match the order and types in GameState(...) exactly.
    jclass gameStateClass = env->FindClass("it/curzel/bitscape/gamecore/GameState");
    if (!gameStateClass) {
        return nullptr; // class not found -- handle error as appropriate
    }

    jmethodID gameStateCtor = env->GetMethodID(
            gameStateClass,
            "<init>",
            "(Lit/curzel/bitscape/gamecore/DisplayableToast;"
            "Lit/curzel/bitscape/gamecore/DisplayableMessage;"
            "Z"     // isInteractionAvailable
            "Lit/curzel/bitscape/gamecore/MatchResult;"
            "F"     // hp
            "Z"     // hasRequestedFastTravel
            "Z"     // hasRequestedPvpArena
            "I"     // currentPlayerIndex
            "Z"     // isPvp
            "Z"     // isTurnPrep
            "F"     // turnTimeLeft
            ")V"
    );
    if (!gameStateCtor) {
        return nullptr; // constructor not found -- handle error
    }

    // 4. Create the actual GameState object by calling its constructor
    jobject jGameState = env->NewObject(
            gameStateClass,
            gameStateCtor,
            jToast,                            // toasts: DisplayableToast?
            jMessage,                          // messages: DisplayableMessage?
            static_cast<jint>(cState.is_interaction_available), // isInteractionAvailable
            jMatchResult,                      // matchResult
            static_cast<jfloat>(cState.hp),    // hp
            static_cast<jint>(cState.has_requested_fast_travel), // hasRequestedFastTravel
            static_cast<jint>(cState.has_requested_pvp_arena),   // hasRequestedPvpArena
            static_cast<jint>(cState.current_player_index),  // currentPlayerIndex
            static_cast<jint>(cState.is_pvp),
            static_cast<jint>(cState.is_turn_prep),
            static_cast<jfloat>(cState.turn_time_left)
    );

    // Return the newly created GameState object to Kotlin
    return jGameState;
}

/**
 * Helper function to create a DisplayableToast object from a CToast struct.
 */
jobject createDisplayableToast(JNIEnv *env, const struct CToast &toast) {
    // 1. Find DisplayableToast class
    jclass toastClass = env->FindClass("it/curzel/bitscape/gamecore/DisplayableToast");
    if (!toastClass) return nullptr;

    // 2. Find its nested classes/constructors
    //    data class DisplayableToast(
    //        val text: String,
    //        val mode: Mode,
    //        val duration: Float,
    //        val image: Image?
    //    )
    jmethodID toastCtor = env->GetMethodID(
            toastClass,
            "<init>",
            "(Ljava/lang/String;"
            "Lit/curzel/bitscape/gamecore/DisplayableToast$Mode;"
            "FLit/curzel/bitscape/gamecore/DisplayableToast$Image;)V"
    );
    if (!toastCtor) return nullptr;

    // 2a. Convert text -> jstring
    jstring jText = toJavaString(env, toast.text);

    // 2b. Convert mode -> Mode enum
    //     You have an enum ToastMode in C and a Mode in Kotlin. Suppose your C enum values
    //     match: 0=Regular, 1=Hint, 2=LongHint. If they differ, map accordingly.
    jclass modeClass = env->FindClass("it/curzel/bitscape/gamecore/DisplayableToast$Mode");
    if (!modeClass) return nullptr;

    // The companion object has `fun fromInt(type: Int)`, but we can also directly get the enum constant.
    // For example, we can do: Mode.values()[toast.mode] if it matches the ordinal.
    // Let’s call the static method fromInt(...) for maximum clarity:
    jmethodID fromIntMethod = env->GetStaticMethodID(
            modeClass,
            "fromInt",
            "(I)Lit/curzel/bitscape/gamecore/DisplayableToast$Mode;"
    );
    if (!fromIntMethod) return nullptr;

    // Suppose your C enum `ToastMode` can be directly cast to int:
    jint modeValue = static_cast<jint>(toast.mode);
    jobject jMode = env->CallStaticObjectMethod(modeClass, fromIntMethod, modeValue);

    // 2c. Convert duration -> jfloat
    jfloat jDuration = static_cast<jfloat>(toast.duration);

    // 2d. Convert image -> DisplayableToast.Image? (null if is_valid == false)
    jobject jImage = nullptr;
    if (toast.image.is_valid) {
        // build the Image object
        jclass imageClass = env->FindClass("it/curzel/bitscape/gamecore/DisplayableToast$Image");
        if (imageClass) {
            jmethodID imageCtor = env->GetMethodID(
                    imageClass,
                    "<init>",
                    "(ILit/curzel/bitscape/gamecore/FRect;)V"  // (spriteSheetId: UInt, textureFrame: FRect)
            );
            if (imageCtor) {
                // sprite_sheet_id -> int
                jint spriteSheetId = static_cast<jint>(toast.image.sprite_sheet_id);

                // create FRect for texture_frame
                jclass FRectClass = env->FindClass("it/curzel/bitscape/gamecore/FRect");
                jmethodID FRectCtor = env->GetMethodID(FRectClass, "<init>", "(IIII)V");
                // (x, y, w, h)
                jobject textureFrameObj = env->NewObject(
                        FRectClass,
                        FRectCtor,
                        static_cast<jint>(toast.image.texture_frame.x),
                        static_cast<jint>(toast.image.texture_frame.y),
                        static_cast<jint>(toast.image.texture_frame.w),
                        static_cast<jint>(toast.image.texture_frame.h)
                );

                jImage = env->NewObject(imageClass, imageCtor, spriteSheetId, textureFrameObj);
            }
        }
    }

    // 3. Finally, create the DisplayableToast object
    jobject displayableToastObj = env->NewObject(
            toastClass,
            toastCtor,
            jText,
            jMode,
            jDuration,
            jImage
    );
    return displayableToastObj;
}

/**
 * Helper function to create a DisplayableMessage object from CDisplayableMessage struct.
 */
jobject createDisplayableMessage(JNIEnv *env, const struct CDisplayableMessage &message) {
    jclass messageClass = env->FindClass("it/curzel/bitscape/gamecore/DisplayableMessage");
    if (!messageClass) return nullptr;

    jmethodID messageCtor = env->GetMethodID(
            messageClass, "<init>",
            "(Ljava/lang/String;Ljava/lang/String;)V"
    );
    if (!messageCtor) return nullptr;

    jstring jTitle = toJavaString(env, message.title);
    jstring jText = toJavaString(env, message.text);

    jobject jDisplayableMessage = env->NewObject(
            messageClass,
            messageCtor,
            jTitle,
            jText
    );
    return jDisplayableMessage;
}

/**
 * Helper function to create a MatchResult object from CMatchResult struct.
 */
jobject createMatchResult(JNIEnv *env, const struct CMatchResult &matchResult) {
    jclass matchResultClass = env->FindClass("it/curzel/bitscape/gamecore/MatchResult");
    if (!matchResultClass) return nullptr;

    jmethodID ctor = env->GetMethodID(
            matchResultClass, "<init>",
            "(IZZZ)V" // (winner: UInt, unknownWinner: Boolean, gameOver: Boolean, inProgress: Boolean)
    );
    if (!ctor) return nullptr;

    // Cast fields to the proper JNI types
    jint winner = static_cast<jint>(matchResult.winner);
    auto jUnknown = static_cast<jboolean>(matchResult.unknown_winner);
    auto jGameOver = static_cast<jboolean>(matchResult.game_over);
    auto jInProgress = static_cast<jboolean>(matchResult.in_progress);

    // Create a new MatchResult
    jobject jMatchResult = env->NewObject(
            matchResultClass, ctor,
            winner,
            jUnknown,
            jGameOver,
            jInProgress
    );

    return jMatchResult;
}

extern "C"
JNIEXPORT jint JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_ammoCountForWeapon(JNIEnv *env, jobject thiz,
                                                              jint weapon_species_id, jint player) {
    auto count = ammo_in_inventory_for_weapon(weapon_species_id, player);
    return static_cast<jint>(count);
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_isTurnPrep(JNIEnv *env, jobject thiz) {
    return is_turn_prep();
}

extern "C"
JNIEXPORT jobject JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_weapons(JNIEnv *env, jobject thiz, jint player) {
    uintptr_t count = 0;
    struct AmmoRecap *weapons = available_weapons_c(player, &count);

    // Handle cases where no weapons are available
    if (weapons == nullptr || count == 0) {
        // Return an empty ArrayList
        jclass arrayListClass = env->FindClass("java/util/ArrayList");
        if (arrayListClass == nullptr) {
            return nullptr; // Class not found
        }
        jmethodID arrayListCtor = env->GetMethodID(arrayListClass, "<init>", "()V");
        if (arrayListCtor == nullptr) {
            return nullptr; // Constructor not found
        }
        return env->NewObject(arrayListClass, arrayListCtor);
    }

    // Find necessary Java classes
    jclass ammoRecapClass = env->FindClass("it/curzel/bitscape/gamecore/AmmoRecap");
    if (ammoRecapClass == nullptr) {
        return nullptr; // Class not found
    }

    jclass FRectClass = env->FindClass("it/curzel/bitscape/gamecore/FRect");
    if (FRectClass == nullptr) {
        return nullptr; // Class not found
    }

    jclass arrayListClass = env->FindClass("java/util/ArrayList");
    if (arrayListClass == nullptr) {
        return nullptr; // Class not found
    }

    // Get constructors
    jmethodID arrayListCtor = env->GetMethodID(arrayListClass, "<init>", "()V");
    jmethodID arrayListAdd = env->GetMethodID(arrayListClass, "add", "(Ljava/lang/Object;)Z");
    if (arrayListCtor == nullptr || arrayListAdd == nullptr) {
        return nullptr; // Methods not found
    }

    jmethodID FRectCtor = env->GetMethodID(FRectClass, "<init>", "(IIII)V");
    if (FRectCtor == nullptr) {
        return nullptr; // Constructor not found
    }

    // Define the AmmoRecap constructor signature
    // (String, int, FRect, FRect, int, int, boolean, boolean, boolean, float)
    jmethodID ammoRecapCtor = env->GetMethodID(
            ammoRecapClass, "<init>",
            "(Ljava/lang/String;I"
            "Lit/curzel/bitscape/gamecore/FRect;"
            "Lit/curzel/bitscape/gamecore/FRect;"
            "Ljava/lang/String;"
            "IIZZZF)V"
    );
    if (ammoRecapCtor == nullptr) {
        return nullptr; // Constructor not found
    }

    // Create an instance of ArrayList to hold AmmoRecap objects
    jobject arrayListObj = env->NewObject(arrayListClass, arrayListCtor);
    if (arrayListObj == nullptr) {
        return nullptr; // Out of memory
    }

    // Iterate through the weapons and convert each to a Java AmmoRecap object
    for (uintptr_t i = 0; i < count; ++i) {
        struct AmmoRecap *current = &weapons[i];

        // Create FRect objects for weaponSprite and weaponInventorySprite
        jobject weaponSprite = env->NewObject(FRectClass, FRectCtor,
                                              current->weapon_sprite.x,
                                              current->weapon_sprite.y,
                                              current->weapon_sprite.w,
                                              current->weapon_sprite.h
        );
        if (weaponSprite == nullptr) {
            // Handle object creation failure
            continue;
        }

        jobject weaponInventorySprite = env->NewObject(FRectClass, FRectCtor,
                                                       current->weapon_inventory_sprite.x,
                                                       current->weapon_inventory_sprite.y,
                                                       current->weapon_inventory_sprite.w,
                                                       current->weapon_inventory_sprite.h
        );
        if (weaponInventorySprite == nullptr) {
            // Handle object creation failure
            env->DeleteLocalRef(weaponSprite);
            continue;
        }

        // Convert C string to Java String
        jstring weaponName = toJavaString(env, current->weapon_name);
        jstring bulletName = toJavaString(env, current->bullet_name);

        // Create the AmmoRecap Java object
        jobject ammoRecapObj = env->NewObject(
                ammoRecapClass,
                ammoRecapCtor,
                weaponName,
                static_cast<jint>(current->weapon_species_id),
                weaponSprite,
                weaponInventorySprite,
                bulletName,
                static_cast<jint>(current->bullet_species_id),
                static_cast<jint>(current->ammo_inventory_count),
                static_cast<jboolean>(current->is_melee),
                static_cast<jboolean>(current->is_ranged),
                static_cast<jboolean>(current->is_equipped),
                static_cast<jfloat>(current->received_damage_reduction)
        );
        if (ammoRecapObj == nullptr) {
            // Handle object creation failure
            env->DeleteLocalRef(weaponSprite);
            env->DeleteLocalRef(weaponInventorySprite);
            continue;
        }

        // Add the AmmoRecap object to the ArrayList
        env->CallBooleanMethod(arrayListObj, arrayListAdd, ammoRecapObj);

        // Check for exceptions during the add operation
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
            // Optionally handle the exception
            break;
        }

        // Clean up local references to avoid memory leaks
        env->DeleteLocalRef(weaponSprite);
        env->DeleteLocalRef(weaponInventorySprite);
        env->DeleteLocalRef(weaponName);
        env->DeleteLocalRef(ammoRecapObj);
    }

    // Optionally, free the weapons array if it was dynamically allocated
    // free(weapons); // Uncomment if necessary

    return arrayListObj;
}

extern "C"
JNIEXPORT void JNICALL
Java_it_curzel_bitscape_gamecore_NativeLib_setWeaponEquipped(JNIEnv *env, jobject thiz,
                                                             jint weapon_species_id,
                                                             jint current_player_index) {
    set_weapon_equipped(weapon_species_id, current_player_index);
}