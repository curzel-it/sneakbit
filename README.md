# SneakBit

So, I got bored, wanted to speriment a bit with Rust, and love GameBoy games, here's the result!

I really enjoyed the process, but have no idea what the final result should be, for now at least.

Like the game or have cool ideas? Join the [Discord](https://discord.gg/MCdEgXKSH5)!

## Play it now!
<div style="display: flex; gap: 10px; justify-content: left; margin: 20px 0;">
<!--
    <a href="https://discord.gg/MCdEgXKSH5">
        <img src="docs/playstore_badge.webp" alt="Play Store" style="max-width: 150px; height: auto;">
    </a> -->
    <a href="https://discord.gg/MCdEgXKSH5">
        <img src="docs/appstore_badge.webp" alt="App Store" style="max-width: 150px; height: auto;">
    </a>
</div>

Coming soon to the Play Store for Android and to Steam for Linux, Windows and macOS

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

The `game_core` create is compiled via `cargo-lipo` and `cargo-ndk`.

```bash
sh scripts/build_ios.sh
sh scripts/build_android.sh
python3 scripts/sync_assets.py
```

## Credits
### Music
Found a great bundle [by Filippo Vicarelli](https://www.filippovicarelli.com/8bit-game-background-music)

### Sounds effects
Found a great bundle [by SubspaceAudio](https://opengameart.org/content/512-sound-effects-8-bit-style) over at OpenGameArt.org

## Screenshots
![Game intro](docs/1.png)
![First level](docs/2.png)
![Map Editor](docs/6.png)
<img src="docs/android.png" alt="Android Screenshot" style="height: 500px">
<img src="docs/ios.jpeg" alt="iOS Screenshot" style="height: 500px;">

## More about the game
I'm taking notes about characters and lore [here](https://github.com/curzel-it/sneakbit/blob/main/docs/game_design_document.md).
![World Map](docs/world_map.png)

## TODO:
- Add proper credits in-game
- Make slopes reflect bullets
- More Quests
- More Lore
- More Game!