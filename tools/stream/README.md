# SneakBit 24/7 livestream

Streams the game — played by the autoplay AI — to YouTube and Twitch, 24/7,
from the same Ubuntu VPS that serves `sneakbit.curzel.it`.

Pipeline (one `master` process + N `relay` processes, each its own systemd
unit so one dead RTMP endpoint can't take the others down):

```
Xvfb :99 ──> Google Chrome (kiosk, /play/?autoplay=1)
                 │  video (X11)        │ audio (PulseAudio null sink)
                 ▼                     ▼
              ffmpeg  ── x11grab + pulse → libx264/aac, encode ONCE
                 │
                 ├─ udp:9101 → relay → rtmp Twitch
                 ├─ udp:9102 → relay → rtmp YouTube (primary ingest)
                 └─ udp:9103 → relay → rtmp YouTube (backup ingest)
```

Adapted from the junkie streamer (`~/dev/junkie`). The one substantive
difference: we capture the **real game audio** out of Chrome via a PulseAudio
null sink (junkie loops an mp3). If PulseAudio can't start, the master falls
back to a silent track so video never breaks.

## Files
- `run_streamer.sh` — the encoder/relay (modes: `master`, `twitch`, `youtube`,
  `youtube-backup`, `debug`). Runs on the VPS.
- `deploy.mjs` — pushes the script, writes the systemd units + env file,
  installs deps, and (re)starts everything. Run from your machine.

## One-time setup
1. Get a persistent stream key from each platform you want:
   - **YouTube**: Studio → Go Live → Stream → a *reusable* stream key.
   - **Twitch**: Creator Dashboard → Settings → Stream → primary stream key.
2. Add to the repo-root `.env` (same file `npm run deploy` uses):
   ```
   YOUTUBE_STREAM_KEY=xxxx-xxxx-xxxx-xxxx-xxxx
   TWITCH_STREAM_KEY=live_xxxxxxxxxxxxxxxxxxxx
   # optional overrides (defaults shown):
   # STREAM_URL=https://sneakbit.curzel.it/play/?autoplay=1
   # STREAM_RES=1280x720
   # STREAM_FPS=30
   # STREAM_BITRATE=3000k
   ```
   A relay with no key stays stopped; the master still captures. `.env` is
   gitignored — keys never get committed.

## Deploy
```
npm run stream:deploy            # install/update units + start
npm run stream:deploy -- --restart   # also force-restart the master
npm run stream:deploy -- --keys      # rewrite env + bounce relays only (key rotation)
```

## Verify (on the VPS)
```
systemctl status sneakbit-streamer.service --no-pager
journalctl -u sneakbit-streamer.service -n 50 --no-pager
journalctl -u sneakbit-streamer-youtube.service -n 20 --no-pager
```
Audio + capture smoke test (writes a local FLV, no RTMP, no freeze watchdog):
```
sudo -u sneakbit-stream env HOME=/home/sneakbit-stream \
  bash /opt/sneakbit-streamer/run_streamer.sh debug
# Ctrl-C after a few seconds, then:
ffprobe /tmp/sneakbit-stream-debug.flv     # expect one video + one aac audio stream
```

## Notes / gotchas
- **Bot dependency.** `?autoplay=1` only does something once the in-page
  autoplay bot ships (phases 2–3). Until then the stream shows the normal game
  (menu/idle) and the master's freezedetect watchdog (90s of unchanging frames
  → restart) may loop. That's expected; it self-heals once the bot keeps the
  canvas moving. Use `debug` mode (no watchdog) to verify the pipeline before
  the bot exists.
- **Build dependency.** The autoplay module must be reachable under `/play/`
  in the deployed `_site`. The plan is a *computed* dynamic import from
  `main.js` so esbuild leaves it as a separate file — that wiring is part of
  phase 2; confirm `npm run build` ships it before relying on `?autoplay=1`.
- **VPS headroom.** 720p30 libx264 `veryfast` is ~1 core; Chrome + Xvfb add
  more. The box also runs the game server + node API + nginx. Check
  `systemd-cgtop` / `htop` after first deploy; drop to 720p `ultrafast` or a
  lower bitrate if it's tight.
- **Platform TOS.** Twitch discourages 24/7 single-content streams; YouTube is
  the safer 24/7 home. Both are wired so you can run either or both.
- **Daily recycle** at 04:00 (±10m jitter) restarts the master to preempt
  Chrome memory creep; relays are intentionally not bound to the master so
  their RTMP sockets survive the ~15s gap and the broadcast stays live.
