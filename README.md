# SneakBit

So, I got bored, wanted to speriment a bit with Rust, and love GameBoy games, here's the result!

I really enjoyed the process, but have no idea what the final result should be, for now at least.

Open to contributions and ideas!

## Run
```bash
# Run the game
cargo run

# Run the game in creative mode to build levels
cargo run creative
```

### Windows
The project uses raylib, so you will need to setup and add to path cmake, libc and the usual stuff before running the steps above.

Personally (but I have no idea what I'm doing and haven't used a windows machine in 10+ years) I did the following:
1. Installed CMake from [here](https://cmake.org/download/)
2. Added CMake to path
3. Installed LLVM via `winget install LLVM.LLVM`
4. `cargo run` 

### iOS
The engine is the same, the rendering is a simple custom view.
The build uses cargo-lipo, just run the script and open the project in Xcode.
```bash
sh scripts/build_ios.sh
```

### Android
The engine is the same, the rendering is a simple custom view.
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

## TODO:
- Add tests to make sure kunai can be used to lower pressure plates
- Add indicator for overlapping enemies (beta testers liked the bug)
- On windows, some users report crashes when certain dialogues start
- Auto pick-up objects
- Throttle entity interactions