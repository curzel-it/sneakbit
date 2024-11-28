<img src="docs/logo_text.png" alt="Logo" style="width: 324px; height: auto; image-rendering: pixelated;">
<br>
Got bored, started sperimenting a bit with Rust, ended up with a game!

Like the game or have cool ideas? Join the [Discord](https://discord.gg/MCdEgXKSH5)!

## Play it now!
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

Please consider buying the game to support the project 🙏

Coming soon to macOS and Linux via Steam!

## Build from source
### macOS, Linux
```bash
# Run the game
cargo run --package game

# Run the game in creative mode to build levels
cargo run --package game creative
```

### Windows
The project uses [Raylib](https://docs.rs/raylib/latest/raylib/), so you will need to setup and add to path cmake, libc and the usual stuff before running the steps above.

Personally (but I have no idea what I'm doing and haven't used a windows machine in 10+ years) I did the following:
1. Installed CMake from [here](https://cmake.org/download/)
2. Added CMake to path
3. Installed LLVM via `winget install LLVM.LLVM`
4. `cargo run --package game` 

### Cross-Compile from macOS for Windows
Setup:
```bash
rustup target add x86_64-pc-windows-gnu
brew install mingw-w64
```

Build:
```bash
cargo build --package game --release --target x86_64-pc-windows-gnu
```

(Optional) Run with Wine:
```bash
brew install --cask wine-stable
wine target/x86_64-pc-windows-gnu/debug/game.exe
```

### iOS and Android
The engine is the same, the rendering is a simple set of custom views for the game itself, menus and such

The `game_core` create is compiled via `cargo-lipo` and `cargo-ndk`.

The `build_all.sh` script will build `game_core`, compile all resources and copy them to the correct folders for both mobile projects.
```bash
sh scripts/build_all.sh
```

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
- Make slopes reflect bullets
- More Quests
- More Lore
- More Game!

## Game Design Document
> Warning: Spoilers!

Notes about lore, quests and characters can be found [here](https://github.com/curzel-it/sneakbit/blob/main/docs/game_design_document.md).

## Controls
| Action | Desktop + Keyboard | Desktop + Gamepad | Mobile |
|--|--|--|--|
| UP | `Arrow Up` or `W` | `Left Side / Up` or `Left Joystick` | Drag gesture |
| RIGHT | `Arrow Right` or `D` | `Left Side / Right` or `Left Joystick` | Drag gesture |
| DOWN | `Arrow Down` or `S` | `Left Side / Down` or `Left Joystick` | Drag gesture |
| LEFT | `Arrow Left` or `A` | `Left Side / Left` or `Left Joystick` | Drag gesture |
| ATTACK | `R` or `F` or `J` or `Q` | `Right Side / Down` | Dedicated button |
| CONFIRM | `E` or `K` or `SPACE` | `Right Side / Right` | Dedicated button |
| MENU | `X` or `ENTER` | `Middle Buttons / Left` | Top-right button |
| BACK | `ESCAPE` | `Middle Buttons / Right` | n/a|

#### Notes:
* On mobile "dedicated buttons" show up only when applicable, for example, the "fire" button only shows up if you have ammo.
* Controller is only supported on desktop
* Connecting or disconnecting a controller automatically pauses the game
* Mouse is only required for "creative mode"
* Cursor is automatically hidden when connecting a controller and when entering fullscreen