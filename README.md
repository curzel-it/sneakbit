# SneakBit

So, I got bored, wanted to speriment a bit with Rust, and love GameBoy games, here's the result!

I really enjoyed the process, but have no idea what the final result should be, for now at least.

Like the game or have cool ideas? Join the [Discord](https://discord.gg/MCdEgXKSH5)!

## Play it now!
<div style="display: flex; gap: 10px; justify-content: left; margin: 20px 0;">
    <a href="https://discord.gg/MCdEgXKSH5">
        <img src="docs/playstore_badge.webp" alt="Play Store" style="max-width: 150px; height: auto;">
    </a>
    <a href="https://discord.gg/MCdEgXKSH5">
        <img src="docs/appstore_badge.webp" alt="App Store" style="max-width: 150px; height: auto;">
    </a>
</div>

(Coming soon to Steam for Linux, Windows and macOS)

## Build from source
### macOS, Linux
```bash
# Run the game
cargo run

# Run the game in creative mode to build levels
cargo run creative
```

### Windows
The project uses [Raylib](https://docs.rs/raylib/latest/raylib/), so you will need to setup and add to path cmake, libc and the usual stuff before running the steps above.

Personally (but I have no idea what I'm doing and haven't used a windows machine in 10+ years) I did the following:
1. Installed CMake from [here](https://cmake.org/download/)
2. Added CMake to path
3. Installed LLVM via `winget install LLVM.LLVM`
4. `cargo run` 

### iOS and Android
The engine is the same, the rendering is a simple set of custom views.

I have a bunch of helpers to generate and copy over resources to the correct places in the mobile projects:
```bash
# Aseprite -> Png
python3 scripts/compile_sprites.py

# Copy ALL assets, including headers to ios and android projects
python3 scripts/sync_assets.py
```

As a simple but significant optimization,iOS and Android use a pre-rendered image instead of rendering individual tiles, which is much, much faster.

#### iOS
The build uses cargo-lipo, just run the script and open the project in Xcode.
```bash
sh scripts/build_ios.sh
```

#### Android
The build uses cargo-ndk, just run the script and open the project in Android Studio.
```bash
sh scripts/build_android.sh
```

## Why lib + bin?
I'm trying to have the engine by completely independent from rendering, which has proved useful for porting the project to iOS and Android.

## Screenshots
![Game intro](docs/1.png)
![First level](docs/2.png)
![Dialogues](docs/4.png)
![Map Editor](docs/6.png)
![Android](docs/android.png)
![iOS](docs/ios.jpeg)

## More about the game
I'm taking notes about characters and lore [here](https://github.com/curzel-it/sneakbit/blob/main/docs/game_design_document.md).
![World Map](docs/world_map.png)

## TODO:
- Make slopes reflect bullets
- Add sound effects
- Add soundtracks (?)
- More Quests
- More Lore
- More Game