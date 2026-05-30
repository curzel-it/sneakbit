#!/usr/bin/env bash
# Re-encode the looping soundtrack tracks (assets/audio/pol_*.mp3) to a
# leaner bitrate. They're short atmospheric loops played through a plain
# <audio loop> element (js/music.js), so 96 kbps stereo is transparent for
# this use while roughly halving the payload of the heavier tracks.
#
# SFX (sfx_*.mp3) are already tiny (<20 KB) and latency-sensitive, so we
# leave them alone. Idempotent: re-running on already-96k files is a no-op
# in size terms. Requires ffmpeg on PATH.
set -euo pipefail

cd "$(dirname "$0")/.."
BITRATE="${1:-96k}"

shopt -s nullglob
total_before=0
total_after=0
for f in assets/audio/pol_*.mp3; do
  before=$(wc -c < "$f")
  tmp="${f}.tmp.mp3"
  ffmpeg -hide_banner -loglevel error -y -i "$f" \
    -codec:a libmp3lame -b:a "$BITRATE" -ar 44100 -ac 2 "$tmp"
  mv "$tmp" "$f"
  after=$(wc -c < "$f")
  total_before=$((total_before + before))
  total_after=$((total_after + after))
  printf '%-40s %8d -> %8d\n' "$(basename "$f")" "$before" "$after"
done

printf '\nTotal: %d -> %d bytes (%d%% smaller)\n' \
  "$total_before" "$total_after" \
  "$(( (total_before - total_after) * 100 / total_before ))"
