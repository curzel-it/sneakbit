#!/usr/bin/env bash
# SneakBit 24/7 livestream encoder. Adapted from the junkie streamer
# (~/dev/junkie/scripts/run_streamer.sh) with one substantive change: we
# capture the REAL game audio out of Chrome via a PulseAudio null sink,
# instead of looping a music file. Everything else — the x11grab capture,
# single libx264 encode, UDP fan-out, and per-platform RTMP relays — mirrors
# junkie's proven shape.
#
# Modes:
#   master          - Xvfb + PulseAudio + Chrome + ffmpeg. Captures the kiosk
#                     page (video) and the game's audio (the null sink's
#                     monitor), encodes once, and fans the packets out over
#                     three local UDP sockets (twitch, youtube, youtube-backup).
#   twitch          - Remux relay: reads the twitch UDP fanout, pushes RTMP.
#   youtube         - Same, YouTube primary ingest.
#   youtube-backup  - Same, YouTube backup ingest (keeps the broadcast alive
#                     when one ingest hiccups).
#   debug           - Single process to a local FLV for smoke testing.
#
# Why split master/relays: a single bad RTMP destination can't take the others
# down. Each relay is its own systemd unit with Restart=always.

set -euo pipefail

MODE="${1:-master}"

STREAM_URL="${STREAM_URL:-https://sneakbit.curzel.it/play/?autoplay=1}"
STREAM_RES="${STREAM_RES:-1280x720}"
STREAM_FPS="${STREAM_FPS:-30}"
STREAM_BITRATE="${STREAM_BITRATE:-3000k}"
DISPLAY_NUM="${DISPLAY_NUM:-:99}"
# PulseAudio runs per-session under a script-managed runtime dir so we don't
# depend on logind lingering. The sink's monitor is what ffmpeg records.
PULSE_RUNTIME="${PULSE_RUNTIME:-/tmp/sneakbit-stream-pulse}"
PULSE_SINK="${PULSE_SINK:-sneakbit_game}"
CHROME_PROFILE="${CHROME_PROFILE:-/tmp/sneakbit-streamer-chrome}"
FANOUT_HOST="${FANOUT_HOST:-127.0.0.1}"
TWITCH_FANOUT_PORT="${TWITCH_FANOUT_PORT:-9101}"
YOUTUBE_FANOUT_PORT="${YOUTUBE_FANOUT_PORT:-9102}"
YOUTUBE_BACKUP_FANOUT_PORT="${YOUTUBE_BACKUP_FANOUT_PORT:-9103}"
YOUTUBE_INGEST_PRIMARY="${YOUTUBE_INGEST_PRIMARY:-rtmp://a.rtmp.youtube.com/live2}"
YOUTUBE_INGEST_BACKUP="${YOUTUBE_INGEST_BACKUP:-rtmp://b.rtmp.youtube.com/live2?backup=1}"
# freezedetect: -60dB ~ "almost identical frames". The bot keeps the canvas
# moving, so a long freeze means the page (or bot) is wedged → full restart.
FREEZE_THRESHOLD_DB="${FREEZE_THRESHOLD_DB:--60dB}"
FREEZE_DURATION_S="${FREEZE_DURATION_S:-90}"

gop=$(( STREAM_FPS * 2 ))

pick_chrome() {
    # google-chrome first — Ubuntu's `chromium` snap blocks windowed mode
    # under systemd (AppArmor).
    if command -v google-chrome >/dev/null 2>&1; then CHROME=google-chrome
    elif command -v chromium >/dev/null 2>&1; then CHROME=chromium
    elif command -v chromium-browser >/dev/null 2>&1; then CHROME=chromium-browser
    else echo "[$MODE] no chrome/chromium binary found" >&2; exit 1; fi
}

# Start a private PulseAudio with a null sink and make it the default, so
# Chrome routes game audio into it and ffmpeg can record the monitor. Echoes
# the monitor source name on success, or nothing if Pulse couldn't start (the
# caller then falls back to silent audio — video must never break on this).
start_pulse() {
    command -v pulseaudio >/dev/null 2>&1 || { echo ""; return; }
    mkdir -p "$PULSE_RUNTIME"; chmod 700 "$PULSE_RUNTIME"
    export XDG_RUNTIME_DIR="$PULSE_RUNTIME"
    export PULSE_SERVER="unix:${PULSE_RUNTIME}/pulse/native"
    # `-D` (daemonize directly), NOT `--start`: the latter relies on autospawn
    # / D-Bus session machinery that isn't present for a headless systemd
    # service user, so it silently fails. --exit-idle-time=-1 keeps it alive
    # with no clients. Root needs the allow flag.
    PULSE_ALLOW=""
    [ "$(id -u)" = "0" ] && export PULSEAUDIO_ALLOW_ROOT=1
    pulseaudio --kill >/dev/null 2>&1 || true  # clear any stale daemon from a prior run
    sleep 0.3
    pulseaudio -D --exit-idle-time=-1 $PULSE_ALLOW >/dev/null 2>&1 || { echo ""; return; }
    sleep 1
    pactl load-module module-null-sink \
        sink_name="$PULSE_SINK" \
        sink_properties=device.description="$PULSE_SINK" >/dev/null 2>&1 || { echo ""; return; }
    pactl set-default-sink "$PULSE_SINK" >/dev/null 2>&1 || true
    echo "${PULSE_SINK}.monitor"
}

run_master() {
    pick_chrome
    rm -rf "${CHROME_PROFILE}"/Singleton* 2>/dev/null || true

    xvfb_pid=""; chrome_pid=""; ffmpeg_pid=""; watchdog_pid=""
    cleanup() {
        for p in "$watchdog_pid" "$ffmpeg_pid" "$chrome_pid" "$xvfb_pid"; do
            [ -n "$p" ] && kill "$p" 2>/dev/null || true
        done
        pulseaudio --kill 2>/dev/null || true
        wait 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM

    echo "[master] Xvfb $DISPLAY_NUM at $STREAM_RES"
    Xvfb "$DISPLAY_NUM" -screen 0 "${STREAM_RES}x24" -nolisten tcp -ac &
    xvfb_pid=$!
    sleep 1

    echo "[master] starting PulseAudio null sink"
    monitor="$(start_pulse)"
    if [ -n "$monitor" ]; then
        echo "[master] audio: capturing $monitor"
        audio_in=( -f pulse -i "$monitor" )
    else
        echo "[master] audio: PulseAudio unavailable, streaming silent"
        audio_in=( -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" )
    fi

    echo "[master] $CHROME -> $STREAM_URL"
    DISPLAY="$DISPLAY_NUM" "$CHROME" \
        --no-sandbox \
        --no-first-run \
        --no-default-browser-check \
        --noerrdialogs \
        --disable-infobars \
        --disable-translate \
        --disable-features=TranslateUI \
        --disable-session-crashed-bubble \
        --disable-dev-shm-usage \
        --disable-gpu \
        --use-gl=swiftshader \
        --kiosk \
        --window-position=0,0 \
        --window-size="${STREAM_RES/x/,}" \
        --autoplay-policy=no-user-gesture-required \
        --user-data-dir="$CHROME_PROFILE" \
        "$STREAM_URL" >/dev/null 2>&1 &
    chrome_pid=$!
    sleep 3

    outputs="[f=mpegts]udp://${FANOUT_HOST}:${TWITCH_FANOUT_PORT}?pkt_size=1316"
    outputs+="|[f=mpegts]udp://${FANOUT_HOST}:${YOUTUBE_FANOUT_PORT}?pkt_size=1316"
    outputs+="|[f=mpegts]udp://${FANOUT_HOST}:${YOUTUBE_BACKUP_FANOUT_PORT}?pkt_size=1316"

    echo "[master] ffmpeg fanout -> 3 UDP sockets"
    ffmpeg -hide_banner -loglevel warning -nostdin \
        -f x11grab -draw_mouse 0 -framerate "$STREAM_FPS" -video_size "$STREAM_RES" -i "$DISPLAY_NUM" \
        "${audio_in[@]}" \
        -map 0:v:0 -map 1:a:0 \
        -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
        -b:v "$STREAM_BITRATE" -maxrate "$STREAM_BITRATE" -bufsize "$STREAM_BITRATE" \
        -g "$gop" -keyint_min "$STREAM_FPS" \
        -c:a aac -b:a 128k -ar 44100 -ac 2 \
        -f tee "$outputs" &
    ffmpeg_pid=$!

    # Side-car freezedetect: captures the same display at 1fps (no encode),
    # kills the encoder after FREEZE_DURATION_S of frozen frames; systemd then
    # restarts the unit.
    (
        set +eo pipefail
        ffmpeg -hide_banner -loglevel info -nostdin \
            -f x11grab -framerate 1 -video_size "$STREAM_RES" -i "$DISPLAY_NUM" \
            -vf "freezedetect=n=${FREEZE_THRESHOLD_DB}:d=${FREEZE_DURATION_S}" \
            -f null - 2>&1 \
            | grep --line-buffered -m1 "freezedetect.freeze_start" >/dev/null
        echo "[master/watchdog] page frozen >= ${FREEZE_DURATION_S}s, terminating encoder"
        kill -TERM "$ffmpeg_pid" 2>/dev/null || true
    ) &
    watchdog_pid=$!

    wait -n "$ffmpeg_pid" "$watchdog_pid"
    exit_code=$?
    echo "[master] background job exited with $exit_code, shutting down"
    exit "$exit_code"
}

run_relay() {
    local name="$1" port="$2" url="$3"
    if [ -z "$url" ]; then
        echo "[$name] destination URL empty, exiting cleanly" >&2
        exit 0
    fi
    safe_url=$(echo "$url" | sed 's/[A-Za-z0-9_-]\{16,\}/<key>/g')
    echo "[$name] relay udp://${FANOUT_HOST}:${port} -> $safe_url"
    # -c copy: the master already encoded once. rw_timeout headroom on input
    # (60s) lets the relay idle through the master's daily recycle without
    # dropping RTMP; tight output timeout (5s) detects a dead edge fast.
    exec ffmpeg -hide_banner -loglevel warning -nostdin \
        -fflags +genpts -err_detect ignore_err \
        -rw_timeout 60000000 \
        -i "udp://${FANOUT_HOST}:${port}?fifo_size=10000000&overrun_nonfatal=1" \
        -c copy -f flv -flvflags +no_duration_filesize \
        -rw_timeout 5000000 \
        "$url"
}

run_twitch() {
    [ -z "${TWITCH_STREAM_KEY:-}" ] && { echo "[twitch] no key, exiting"; exit 0; }
    run_relay twitch "$TWITCH_FANOUT_PORT" "rtmp://live.twitch.tv/app/${TWITCH_STREAM_KEY}"
}

# YouTube ingest URLs may carry a query string (?backup=1); the key goes in
# the path segment before the query.
build_yt_url() {
    local base="$1" key="$2"
    case "$base" in
        *\?*) printf '%s/%s?%s\n' "${base%%\?*}" "$key" "${base#*\?}" ;;
        *)    printf '%s/%s\n' "$base" "$key" ;;
    esac
}

run_youtube() {
    [ -z "${YOUTUBE_STREAM_KEY:-}" ] && { echo "[youtube] no key, exiting"; exit 0; }
    run_relay youtube "$YOUTUBE_FANOUT_PORT" "$(build_yt_url "$YOUTUBE_INGEST_PRIMARY" "$YOUTUBE_STREAM_KEY")"
}

run_youtube_backup() {
    [ -z "${YOUTUBE_STREAM_KEY:-}" ] && { echo "[youtube-backup] no key, exiting"; exit 0; }
    run_relay youtube-backup "$YOUTUBE_BACKUP_FANOUT_PORT" "$(build_yt_url "$YOUTUBE_INGEST_BACKUP" "$YOUTUBE_STREAM_KEY")"
}

run_debug() {
    pick_chrome
    rm -rf "${CHROME_PROFILE}"/Singleton* 2>/dev/null || true
    xvfb_pid=""; chrome_pid=""
    cleanup() {
        [ -n "$chrome_pid" ] && kill "$chrome_pid" 2>/dev/null || true
        [ -n "$xvfb_pid" ] && kill "$xvfb_pid" 2>/dev/null || true
        pulseaudio --kill 2>/dev/null || true
        wait 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM

    Xvfb "$DISPLAY_NUM" -screen 0 "${STREAM_RES}x24" -nolisten tcp -ac &
    xvfb_pid=$!
    sleep 1
    monitor="$(start_pulse)"
    if [ -n "$monitor" ]; then audio_in=( -f pulse -i "$monitor" )
    else audio_in=( -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" ); fi

    DISPLAY="$DISPLAY_NUM" "$CHROME" \
        --no-sandbox --no-first-run --kiosk --disable-gpu --use-gl=swiftshader \
        --autoplay-policy=no-user-gesture-required \
        --window-size="${STREAM_RES/x/,}" \
        --user-data-dir="$CHROME_PROFILE" \
        "$STREAM_URL" >/dev/null 2>&1 &
    chrome_pid=$!
    sleep 3

    echo "[debug] writing /tmp/sneakbit-stream-debug.flv (ffplay it to inspect)"
    exec ffmpeg -hide_banner -loglevel info \
        -f x11grab -draw_mouse 0 -framerate "$STREAM_FPS" -video_size "$STREAM_RES" -i "$DISPLAY_NUM" \
        "${audio_in[@]}" \
        -map 0:v:0 -map 1:a:0 \
        -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
        -b:v "$STREAM_BITRATE" -maxrate "$STREAM_BITRATE" -bufsize "$STREAM_BITRATE" \
        -g "$gop" -keyint_min "$STREAM_FPS" \
        -c:a aac -b:a 128k -ar 44100 -ac 2 \
        -f flv /tmp/sneakbit-stream-debug.flv
}

case "$MODE" in
    master)         run_master ;;
    twitch)         run_twitch ;;
    youtube)        run_youtube ;;
    youtube-backup) run_youtube_backup ;;
    debug)          run_debug ;;
    *) echo "unknown mode: $MODE (master|twitch|youtube|youtube-backup|debug)" >&2; exit 2 ;;
esac
