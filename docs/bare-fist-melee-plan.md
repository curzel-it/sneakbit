# Bare-fist melee (punch + kick) — implementation plan

Status: **planned, not yet implemented**. Roll is deferred (rows reserved, anim
system built to accept it later). `../doom` will reuse these animations.

## Behavior

- **Bare fists = the default melee weapon.** Today pressing melee with no melee
  weapon equipped does nothing (`melee.js::weaponProfile()` returns `null`, so
  `swing()` aborts). New behavior: it triggers a bare-fist attack.
- **Combo on the melee key.** Successive taps alternate
  **punch → kick → punch → kick**. A combo-window timer (~0.8 s) resets the
  chain back to punch if the player stops. A per-player cooldown gates spam —
  punch is fast/cheap, kick is slightly slower, harder, with more reach.
- **Equipping a melee weapon restores the normal weapon swing** — zero change
  for armed players.
- **Dedicated body sprites.** Unlike weapons (which animate an *overlay* on top
  of the hero), bare fists animate the **hero body itself**: punch and kick each
  get their own directional sprite rows, driven by a timed animation that
  overrides the walk/idle row.

## Sprite-sheet contract (art TBD, system wired around it)

`heroes.png` is currently 464×304 px = 29×19 tiles (TILE_SIZE = 16). Hero frames
are 1×2-tile cells in 4-frame strips per skin; skin columns live at
x = 1, 5, 9, 13, 17, 21. Rows start at tile y = 1.

| rows  | content                                              | tile-y |
|-------|------------------------------------------------------|--------|
| 0–7   | up/right/down/left × moving/still (existing)         | 1–16   |
| 8–11  | **punch** — up, right, down, left                    | 17–24  |
| 12–15 | **kick** — up, right, down, left                     | 25–32  |
| 16–19 | *roll (reserved, later)*                             | 33–40  |

- Row order matches the existing convention: **up → right → down → left**.
- One row per facing per action, up to 4 frames across.
- For punch + kick the sheet must grow to **≥ 528 px tall** (33 tiles); leave
  **656 px** (41 tiles) to reserve the roll block. Width unchanged.
- Frame count per action is **configurable** (2- or 4-frame art both work);
  exact counts confirmed once the art lands.

## Files to touch

1. **`js/heroActionAnimation.js`** *(new — one feature, one file)*: per-player
   timed body-action state (`punch` / `kick` / future `roll`). Exposes
   `setHeroActionAnim(idx, action, dur)`, `getHeroActionAnim(idx)`,
   `tickHeroActionAnim(dt)`. Generic so roll slots in later.
2. **`js/player.js`** — `getPlayerSpriteFrame()` consults the action anim: if
   active, pick the action's row-block + frame from progress; else current
   walk/idle. Single seam → covers local, co-op, and network-mirror avatars.
   Add row-block constants.
3. **`js/melee.js`** — add `bareFistProfile(swinger, comboStep)` (punch vs kick
   params, reusing the invisible carrier-bullet pattern from `giantFistProfile`
   so no new species data is needed). In `performMeleeSwing`: when not giant and
   no weapon equipped → bare-fist path; track per-player combo step + window;
   trigger the body anim + SFX. Wire the body anim into `predictGuestSwing` for
   guest-side prediction.
4. **`js/snapshotBroadcaster.js` + `js/mirrorWorld.js`** — carry current action +
   progress per player so the host's and other guests' **bodies** show punch/kick
   (the existing swing-progress channel only drives weapon overlays).
5. **Tick wiring** — call `tickHeroActionAnim(dt)` alongside `tickMelee`.
6. **Tests** — unit: profile selection (no weapon → punch then kick alternation),
   combo reset, cooldown gating, anim state machine, row resolution. Run the e2e
   suite before any push (this touches the snapshot/mirror netcode files).

## Not in this pass

- **Roll** — awaiting spec; rows reserved, anim file built to accept it.
- **New key bindings** — the combo reuses the existing melee key, so no
  keyboard / gamepad / touch binding changes.
- **`../doom` reuse** — out of scope here; these animations are intended to be
  reused there later.

## Open question

How many frames per punch / kick (2 or 4)? Defaulting to support up to 4; the
real count is set once the art is in.
