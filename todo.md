# TODO

## Overall Goal
Our guiding start is that the JS port will replace the Rust codebase in production via Electron or similar, across all platforms.
- [ ] Do a complete playthrough for testing
- [ ] Add translation support and italian localization
- [ ] Gamepad/controller support (P1-P4 local, online guests, rumble, rebindable buttons, active-device glyphs, connect/disconnect + disconnect-pause, and keyboard+controller menu navigation all wired)
  - [ ] Controllers on mobile
  - [ ] Steam Input proper (per-brand PS/Switch/Deck glyphs + remap-aware, In-Game Actions manifest, official config) — needs the Electron/Steamworks shell
- [ ] Native wrapper (needs to be an actual app for mobile, single binary for Steam, ...)
- [ ] Full screen support
- [ ] Probably other things I don't remember rn
- [ ] Game remains playable completely offline, like it always was