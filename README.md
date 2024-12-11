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

Available now on [Steam](https://store.steampowered.com/app/3360860/SneakBit) for Windows and macOS, support for Linux coming soon!

## Features
* Adventure-action gameplay with kunai and sword combat
* Grid-based tiling system with biomes and constructions
* Unlockable combat skills
* Nostalgic Gameboy-like pixel art aesthetics
* Local co-op multiplayer mode for PC
* Coming soon! Linux / Steam Deck support

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

The `game_core` create is compiled via `cargo-lipo` and `cargo-ndk`.

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
- Some defense ability
- Some wide-area ability
- More Quests
- More Lore
- More Game!

## Game Design Document
> Warning: Spoilers!

Notes about lore, quests and characters can be found [here](https://github.com/curzel-it/sneakbit/blob/main/docs/game_design_document.md).

## Controls
### Player 1 
| Action | Keyboard | Gamepad | Mobile |
|--|--|--|--|
| UP | `Arrow Up` or `W` | `Left Side / Up` or `Left Joystick` | Drag gesture |
| RIGHT | `Arrow Right` or `D` | `Left Side / Right` or `Left Joystick` | Drag gesture |
| DOWN | `Arrow Down` or `S` | `Left Side / Down` or `Left Joystick` | Drag gesture |
| LEFT | `Arrow Left` or `A` | `Left Side / Left` or `Left Joystick` | Drag gesture |
| RANGED ATTACK | `F` or `J` | `Right Side / Down` | Dedicated button |
| CLOSE ATTACK | `R` or `Q` | `Right Side / Left` | Dedicated button |
| CONFIRM | `E` or `K` or `SPACE` | `Right Side / Right` | Dedicated button |
| MENU | `X` or `ENTER` | `Middle Buttons / Left` | Top-right button |
| BACK | `ESCAPE` | `Middle Buttons / Right` | n/a |

### Player 2
| Action | Keyboard | Gamepad | Mobile |
|--|--|--|--|
| UP | `Home` | `Left Side / Up` or `Left Joystick` | n/a |
| RIGHT | `Page Down` | `Left Side / Right` or `Left Joystick` | n/a |
| DOWN | `End` | `Left Side / Down` or `Left Joystick` | n/a |
| LEFT | `Delete` | `Left Side / Left` or `Left Joystick` | n/a |
| RANGED ATTACK | `Right Shift` | `Right Side / Down` | n/a |
| CLOSE ATTACK | `Right Control` | `Right Side / Left` | n/a |
| CONFIRM | `Insert` | `Right Side / Right` | n/a |
| MENU | n/a | `Middle Buttons / Left` | n/a |
| BACK | n/a | `Middle Buttons / Right` | n/a |

### Player 3 and 4
Gamepad only

#### Notes:
* Local co-op available only on PC and is still in development.
* Keyboard and Gamepad are only supported on PC
* On mobile "dedicated buttons" show up only when applicable, for example, the "fire" button only shows up if you have ammo.
* Controller is only supported on desktop
* Connecting or disconnecting a controller automatically pauses the game
* Mouse is only required for "creative mode"
* Cursor is automatically hidden when connecting a controller and when entering fullscreen