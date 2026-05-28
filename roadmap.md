# TODO

## Overall Goal
Our guiding start is that the JS port will replace the Rust codebase in production via Electron or similar, across all platforms.
- [ ] Do a complete playthrough for testing
- [ ] Add translation support and italian localization
- [ ] Gamepad/controller support (P1 works; online guests not wired)
- [ ] Local co-op with up to 4 players (currently limited to 2)
- [ ] Native wrapper (needs to be an actual app for mobile, single binary for Steam, ...)
- [ ] Full screen support
- [ ] Probably other things I don't remember rn
- [ ] Game remains playable completely offline, like it always was

## Ideas 

- [ ] Snapshot's `t` is a broadcaster counter today — ship the host's real game tick (or wall-clock) for time-based interpolation; would let the mirror render at host-time `t` instead of receive-time, smoothing over dropped frames

## To be verified

- [ ] On the guest client during an online co-op the host avatar moves in a choppy way (both on local an prod server) — likely network jitter + small prediction snap-backs; needs browser-level investigation
- [ ] On the guest client during an online co-op with a still host the game "jumps 1 tile up and down" at regular intervals (both on local an prod server) — suspected predictedSelf snap-back when host's auth lags guest's chained step by one tile; needs browser repro to confirm

## Stuff