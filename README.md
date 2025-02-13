<img src="docs/logo_text.png" alt="Logo" style="width: 324px; height: auto; image-rendering: pixelated;">
<br>
Started the project with the objective to learn Rust, ended up with an actual game!

Like the game or have cool ideas? Join the [Discord](https://discord.gg/MCdEgXKSH5)!

## Play it now!
Please consider buying the game on Steam to support the project 🙏

Available now on [Steam](https://store.steampowered.com/app/3360860/SneakBit) for Windows and macOS, support for Linux coming soon!

<div style="display: flex; gap: 10px; justify-content: left; margin: 20px 0;">
    <a href="https://store.steampowered.com/app/3360860/SneakBit/">
        <img src="docs/steam_badge.webp" alt="Steam" style="width: 200px; height: auto;">
    </a>
    <a href="https://apps.apple.com/app/sneakbit/id6737452377">
        <img src="docs/appstore_badge.webp" alt="App Store" style="width: 200px; height: auto;">
    </a>
    <a href="https://play.google.com/store/apps/details?id=it.curzel.bitscape">
        <img src="docs/playstore_badge.webp" alt="Play Store" style="width: 200px; height: auto;">
    </a>
</div>

## Features
* Adventure-action gameplay with close and long range combat
* Unlockable combat skills
* Nostalgic Gameboy-like pixel art aesthetics
* Local co-op multiplayer mode for PC
* Unlockable Fast travel
* Turn-based Pvp 
* Coming soon! Linux & SteamOS support
* Pre-rendered backgrounds using a dual-layer tiling system
* AABB collision detection

## Build from source
### macOS, Linux
```bash
# Run the game
cargo run --package game

# Run the game in creative mode to build levels
cargo run --package game creative
```

### Cross-Compile from macOS for Windows
```bash
# Setup
rustup target add x86_64-pc-windows-gnu
brew install mingw-w64

# Build
cargo build --package game --release --target x86_64-pc-windows-gnu
```

### iOS and Android
The engine is the same, the rendering is a simple set of custom views for the game itself, menus and such

The `game_core` create is compiled via `cargo-lipo` and `cargo-ndk`, bindings are generated using `cbindgen`.
```bash
cargo install cargo-lipo
cargo install cargo-ndk # Requires getting the Android NDK
cargo install cbindgen

rustup target add x86_64-apple-ios
rustup target add aarch64-apple-ios
rustup target add armv7-linux-androideabi
rustup target add aarch64-linux-android
rustup target add i686-linux-android
rustup target add x86_64-linux-android
```

The `build_all.sh` script will build `game_core`, compile all resources and copy them to the correct folders for both mobile projects.
```bash
sh scripts/build_all.sh
```

### Windows
The project uses [Raylib](https://docs.rs/raylib/latest/raylib/), so there are some extra steps after setting up Rust.

Personally (but I have no idea what I'm doing and haven't used a windows machine in 10+ years) I did the following:
1. Installed CMake from [here](https://cmake.org/download/)
2. Added CMake to path
3. Installed LLVM via `winget install LLVM.LLVM`
4. `cargo run --package game` 

## Screenshots
<img src="docs/steam/4.png" style="width: 756px; height: auto; image-rendering: pixelated;">
<img src="docs/steam/5.png" style="width: 756px; height: auto; image-rendering: pixelated;">
<img src="docs/steam/1.png" style="width: 756px; height: auto; image-rendering: pixelated;">
<img src="docs/steam/2.png" style="width: 756px; height: auto; image-rendering: pixelated;">
<img src="docs/steam/3.png" style="width: 756px; height: auto; image-rendering: pixelated;">

## Credits
* Music by [Filippo Vicarelli](https://www.filippovicarelli.com/8bit-game-background-music)
* Sound Effects by [SubspaceAudio](https://opengameart.org/content/512-sound-effects-8-bit-style)
* Font by [HarvettFox96](https://dl.dafont.com/dl/?f=pixel_operator)

## TODO:
* Pvp weapon selection on mobile
* Finish writing "Consipiracy Theorist" quest
* Finish writing "Assassin Guild" quest
* Push notifications for updates and new content
* Better hints for mobile players
* Camera pan when turn changes in pvp

## Game Design Document
> Warning: Spoilers!

Notes about lore, quests and characters can be found [here](https://github.com/curzel-it/sneakbit/blob/main/docs/game_design_document.md).

## Controls
### Single Player
| Action | Keyboard | Gamepad | Mobile |
|--|--|--|--|
| UP | `Arrow Up` or `W` | `Left Side / Up` or `Left Joystick` | Drag gesture |
| RIGHT | `Arrow Right` or `D` | `Left Side / Right` or `Left Joystick` | Drag gesture |
| DOWN | `Arrow Down` or `S` | `Left Side / Down` or `Left Joystick` | Drag gesture |
| LEFT | `Arrow Left` or `A` | `Left Side / Left` or `Left Joystick` | Drag gesture |
| RANGED ATTACK | `F` or `J` | `Right Side / Down` | Dedicated button |
| CLOSE ATTACK | `R` or `Q` | `Right Side / Left` | Dedicated button |
| WEAPON SELECTION | `TAB` | `Right Side / Up` | Dedicated button |
| CONFIRM | `E` or `K` or `SPACE` | `Right Side / Right` | Dedicated button |
| MENU | `X` or `ENTER` | `Middle Buttons / Left` | Top-right button |
| BACK | `ESCAPE` | `Middle Buttons / Right` | n/a |

### Multiplayer
* Local co-op available only on PC
* Requires using one controller per player
* Player one can still use the keyboard (but still requires a controller)

#### Notes:
* Keyboard and Gamepad are only supported on PC
* On mobile "dedicated buttons" show up only when applicable, for example, the "fire" button only shows up if you have ammo.
* Controller is only supported on desktop
* Connecting or disconnecting a controller automatically pauses the game
* Cursor is automatically hidden when connecting a controller and when entering fullscreen