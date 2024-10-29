cmake_minimum_required(VERSION 3.4.1)

# Build the JNI bridge library
add_library( native-lib
        SHARED
        native-lib.cpp )

# Include the directory containing game_core.h
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs)

# Import your pre-built native library
add_library( game_core
        SHARED
        IMPORTED )

# Set the properties for the imported library without using absolute paths
set_target_properties( game_core
        PROPERTIES IMPORTED_LOCATION
        "${CMAKE_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libgame_core.so"
        IMPORTED_NO_SONAME TRUE)

# Link the libraries
target_link_libraries( native-lib
        game_core )
