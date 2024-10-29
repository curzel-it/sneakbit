cargo ndk \
    --platform 30 \
    --target armeabi-v7a \
    --target arm64-v8a \
    --target x86 \
    --target x86_64 \
    --output-dir android/Rust \
    -- build --release --package game_core

cbindgen --config game_core/cbindgen.toml --crate game_core --output game_core.h

rm -rf android/app/src/main/jniLibs/*
mkdir -p android/app/src/main/jniLibs/{armeabi-v7a,arm64-v8a,x86,x86_64}
cp target/armv7-linux-androideabi/release/libgame_core.so android/app/src/main/jniLibs/armeabi-v7a/
cp target/aarch64-linux-android/release/libgame_core.so android/app/src/main/jniLibs/arm64-v8a/
cp target/i686-linux-android/release/libgame_core.so android/app/src/main/jniLibs/x86/
cp target/x86_64-linux-android/release/libgame_core.so android/app/src/main/jniLibs/x86_64/
cp game_core.h android/app/src/main/jniLibs/