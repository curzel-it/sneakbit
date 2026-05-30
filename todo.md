# TODO

## Next batch
- [x] Add translation support and italian localization — `tr()` fallback + language detection/selection (settings.js), `data/strings.it.json` generated from the original `lang/it.stringx` via `tools/stringx2json.mjs`. UI chrome (menu labels) still hardcoded English — follow-up below.
- [x] Full screen support — `js/fullscreen.js` + pause-menu toggle
- [x] Minify sound track mp3 files — `tools/minify-music.sh`, soundtrack 4.0MB→2.8MB (96k stereo)
- [x] Create a md file with specifications of the pvp mode — `docs/pvp.md` (Rust model + local + online extension)

## Backlog
- [ ] Localize the UI chrome too (menu/settings/credits labels are still hardcoded English; only in-world content goes through `tr()`)
- [ ] Steam Input proper (per-brand PS/Switch/Deck glyphs + remap-aware, In-Game Actions manifest, official config) — needs the Electron/Steamworks shell

