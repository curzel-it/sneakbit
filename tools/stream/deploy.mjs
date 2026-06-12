#!/usr/bin/env node
// Deploy the SneakBit 24/7 livestream to the same Ubuntu VPS that serves
// sneakbit.curzel.it. Self-contained (ssh2, like tools/deploy.mjs) — installs
// the capture deps, pushes run_streamer.sh, writes the systemd units, and
// (re)starts them. Idempotent.
//
// Units created:
//   sneakbit-streamer.service                — master (Xvfb + Pulse + Chrome + ffmpeg)
//   sneakbit-streamer-twitch.service         — relay -> Twitch
//   sneakbit-streamer-youtube.service        — relay -> YouTube primary ingest
//   sneakbit-streamer-youtube-backup.service — relay -> YouTube backup ingest
//   sneakbit-streamer-recycle.timer          — daily master restart (mem creep)
//
// .env keys (repo root): IP_ADDRESS, SSH_USERNAME, SSH_PASSWORD (required);
// TWITCH_STREAM_KEY and/or YOUTUBE_STREAM_KEY (a relay with no key stays
// stopped); optional STREAM_URL / STREAM_RES / STREAM_FPS / STREAM_BITRATE.
//
// Usage:
//   node tools/stream/deploy.mjs            # install/update + start
//   node tools/stream/deploy.mjs --restart  # also force-restart the master
//   node tools/stream/deploy.mjs --keys     # rewrite env + bounce relays only

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let Client;
try { ({ Client } = require("ssh2")); }
catch { die("ssh2 not installed — run `npm install` and retry."); }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HERE = dirname(fileURLToPath(import.meta.url));

const APP = "sneakbit-streamer";
const USER = "sneakbit-stream";
const REMOTE_DIR = `/opt/${APP}`;
const ENV_PATH = `/etc/${APP}.env`;
const RELAYS = ["twitch", "youtube", "youtube-backup"];
const RELAY_RESTART_SEC = { twitch: 10, youtube: 3, "youtube-backup": 3 };

const args = new Set(process.argv.slice(2));
const FORCE_RESTART = args.has("--restart");
const KEYS_ONLY = args.has("--keys");

main().catch((e) => { console.error(e.message || e); process.exit(1); });

async function main() {
  const env = loadEnv(join(ROOT, ".env"));
  await connect(env);
  console.log(`[stream] deploying to ${env.IP_ADDRESS}`);

  if (!KEYS_ONLY) {
    await stepDeps(env);
    await stepUser(env);
    await stepScript(env);
  }
  await stepEnvFile(env);
  await stepUnits(env);
  await stepActivate(env);
  printVerify(env);
  end();
}

async function stepDeps(env) {
  console.log("[1/6] install capture deps (xvfb, ffmpeg, pulseaudio, chrome)");
  await ssh(env, "DEBIAN_FRONTEND=noninteractive apt-get update -qq");
  await ssh(env,
    "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq " +
    "xvfb ffmpeg pulseaudio pulseaudio-utils fonts-noto-core ca-certificates wget");
  // google-chrome-stable: the snap chromium won't run windowed under systemd.
  await ssh(env,
    "command -v google-chrome >/dev/null 2>&1 || (" +
    "wget -q -O /tmp/chrome.deb " +
    "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && " +
    "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/chrome.deb && " +
    "rm -f /tmp/chrome.deb)");
}

async function stepUser(env) {
  console.log("[2/6] ensure service user + dirs");
  await ssh(env,
    `id -u ${USER} >/dev/null 2>&1 || useradd --system --create-home ` +
    `--home-dir /home/${USER} --shell /usr/sbin/nologin ${USER}`);
  await ssh(env, `mkdir -p ${REMOTE_DIR} && chown ${USER}:${USER} ${REMOTE_DIR}`);
}

async function stepScript(env) {
  console.log("[3/6] push run_streamer.sh");
  const script = readFileSync(join(HERE, "run_streamer.sh"), "utf8");
  await writeRemoteFile(env, `${REMOTE_DIR}/run_streamer.sh`, script, "0755");
  await ssh(env, `chown ${USER}:${USER} ${REMOTE_DIR}/run_streamer.sh`);
}

async function stepEnvFile(env) {
  console.log("[4/6] write streamer env");
  const lines = [
    `STREAM_URL=${env.STREAM_URL || "https://sneakbit.curzel.it/play/?autoplay=1"}`,
    `STREAM_RES=${env.STREAM_RES || "1280x720"}`,
    `STREAM_FPS=${env.STREAM_FPS || "30"}`,
    `STREAM_BITRATE=${env.STREAM_BITRATE || "3000k"}`,
    `HOME=/home/${USER}`,
  ];
  if (env.TWITCH_STREAM_KEY) lines.push(`TWITCH_STREAM_KEY=${env.TWITCH_STREAM_KEY}`);
  if (env.YOUTUBE_STREAM_KEY) lines.push(`YOUTUBE_STREAM_KEY=${env.YOUTUBE_STREAM_KEY}`);
  await writeRemoteFile(env, ENV_PATH, lines.join("\n") + "\n", "0600");
}

async function stepUnits(env) {
  console.log("[5/6] write systemd units");
  await writeRemoteFile(env, `/etc/systemd/system/${APP}.service`, masterUnit());
  for (const relay of RELAYS) {
    await writeRemoteFile(env, `/etc/systemd/system/${APP}-${relay}.service`, relayUnit(relay));
  }
  await writeRemoteFile(env, `/etc/systemd/system/${APP}-recycle.service`, recycleService());
  await writeRemoteFile(env, `/etc/systemd/system/${APP}-recycle.timer`, recycleTimer());
  await ssh(env, "systemctl daemon-reload");
}

async function stepActivate(env) {
  console.log("[6/6] (re)start units");
  const restart = FORCE_RESTART || KEYS_ONLY;
  if (!KEYS_ONLY) {
    await ssh(env, `systemctl enable ${APP}.service`);
    await ssh(env, `systemctl ${restart ? "restart" : "start"} ${APP}.service`);
  }
  for (const relay of RELAYS) {
    const key = relay === "twitch" ? env.TWITCH_STREAM_KEY : env.YOUTUBE_STREAM_KEY;
    const unit = `${APP}-${relay}.service`;
    if (key) {
      await ssh(env, `systemctl enable ${unit}`);
      await ssh(env, `systemctl ${restart ? "restart" : "start"} ${unit}`);
    } else {
      await ssh(env, `systemctl disable --now ${unit}`, { check: false });
    }
  }
  if (!KEYS_ONLY) await ssh(env, `systemctl enable --now ${APP}-recycle.timer`);
}

function printVerify(env) {
  console.log(`
[stream] deployed. Verify on the VPS:
  systemctl status ${APP}.service --no-pager
  journalctl -u ${APP}.service -n 50 --no-pager
  journalctl -u ${APP}-youtube.service -n 20 --no-pager

  # Confirm capture + game audio before going live, on the box:
  sudo -u ${USER} env HOME=/home/${USER} bash ${REMOTE_DIR}/run_streamer.sh debug
  #   then ffprobe /tmp/sneakbit-stream-debug.flv  (expect a video + an aac audio stream)

Stream keys live in ${ENV_PATH} (0600). To rotate keys: edit .env, run
\`node tools/stream/deploy.mjs --keys\`. YouTube/Twitch must have a live
broadcast configured for the key before frames will show.`);
}

// ---- systemd unit templates (mirror junkie's proven shapes) ----------------

function masterUnit() {
  return `[Unit]
Description=SneakBit 24/7 livestream master (Xvfb + PulseAudio + Chrome + ffmpeg fanout)
After=network-online.target
Wants=network-online.target
StartLimitBurst=20
StartLimitIntervalSec=600

[Service]
Type=simple
User=${USER}
WorkingDirectory=${REMOTE_DIR}
EnvironmentFile=${ENV_PATH}
ExecStart=/bin/bash ${REMOTE_DIR}/run_streamer.sh master
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

function relayUnit(name) {
  // Intentionally NOT PartOf/BindsTo the master: a master restart (daily
  // recycle, freezedetect trip) must leave the relay's RTMP socket open so
  // YouTube/Twitch don't end the broadcast. The relay idles on UDP during the
  // gap (input rw_timeout in run_streamer.sh is the headroom).
  return `[Unit]
Description=SneakBit 24/7 livestream relay -> ${name}
After=network-online.target ${APP}.service
Wants=network-online.target
StartLimitBurst=20
StartLimitIntervalSec=600

[Service]
Type=simple
User=${USER}
WorkingDirectory=${REMOTE_DIR}
EnvironmentFile=${ENV_PATH}
ExecStart=/bin/bash ${REMOTE_DIR}/run_streamer.sh ${name}
Restart=always
RestartSec=${RELAY_RESTART_SEC[name] ?? 10}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

function recycleService() {
  return `[Unit]
Description=Daily recycle of the SneakBit 24/7 livestream master

[Service]
Type=oneshot
ExecStart=/bin/systemctl restart ${APP}.service
`;
}

function recycleTimer() {
  return `[Unit]
Description=Daily recycle timer for the SneakBit 24/7 livestream

[Timer]
OnCalendar=*-*-* 04:00:00
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
`;
}

// ---- ssh2 plumbing (mirrors tools/deploy.mjs, incl. host-key pinning) ------

function loadEnv(path) {
  if (!existsSync(path)) die(`missing ${path}`);
  const env = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[line.slice(0, eq).trim()] = val;
  }
  for (const r of ["IP_ADDRESS", "SSH_USERNAME", "SSH_PASSWORD"]) {
    if (!(r in env)) die(`missing ${r} in ${path}`);
  }
  if (!env.TWITCH_STREAM_KEY && !env.YOUTUBE_STREAM_KEY) {
    console.warn("[stream] WARNING: no TWITCH_STREAM_KEY or YOUTUBE_STREAM_KEY in .env — " +
      "all relays will stay stopped (master still captures).");
  }
  return env;
}

const KNOWN_HOSTS = join(ROOT, ".deploy_known_hosts");
function loadPinnedKey(host) {
  if (!existsSync(KNOWN_HOSTS)) return null;
  for (const raw of readFileSync(KNOWN_HOSTS, "utf8").split(/\r?\n/)) {
    const [h, fp] = raw.trim().split(/\s+/);
    if (h === host && fp) return fp;
  }
  return null;
}
function pinKey(host, fp) {
  const existing = existsSync(KNOWN_HOSTS) ? readFileSync(KNOWN_HOSTS, "utf8") : "";
  writeFileSync(KNOWN_HOSTS, existing + `${host} ${fp}\n`);
}

let _conn = null;
function connect(env) {
  if (_conn) return Promise.resolve(_conn);
  const host = env.IP_ADDRESS;
  return new Promise((res, rej) => {
    const conn = new Client();
    conn.on("ready", () => { _conn = conn; res(conn); });
    conn.on("error", rej);
    conn.connect({
      host, port: 22, username: env.SSH_USERNAME, password: env.SSH_PASSWORD,
      hostVerifier: (key) => {
        const fp = createHash("sha256").update(key).digest("base64");
        const pinned = loadPinnedKey(host);
        if (pinned === null) { console.log(`  pinning host key for ${host}: SHA256:${fp}`); pinKey(host, fp); return true; }
        if (pinned !== fp) {
          console.error(`\n[!] HOST KEY MISMATCH for ${host} — refusing. If reimaged, delete the stale line in ${KNOWN_HOSTS}.`);
          return false;
        }
        return true;
      },
    });
  });
}

function ssh(env, cmd, { check = true } = {}) {
  console.log(`  ssh> ${cmd.length > 100 ? cmd.slice(0, 97) + "..." : cmd}`);
  return connect(env).then((conn) => new Promise((res, rej) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return rej(err);
      let out = "", errOut = "";
      stream.on("data", (d) => { out += d; process.stdout.write(d); });
      stream.stderr.on("data", (d) => { errOut += d; process.stderr.write(d); });
      stream.on("close", (code) => {
        if (check && code !== 0) return rej(new Error(`remote failed (exit ${code}): ${cmd}\n${errOut}`));
        res({ code, stdout: out, stderr: errOut });
      });
      stream.end();
    });
  }));
}

// Write a remote file via `cat > path` over stdin (no SFTP needed for a
// handful of small files), then chmod. Content is fed on the exec stream.
function writeRemoteFile(env, path, content, mode = null) {
  console.log(`  write> ${path}`);
  return connect(env).then((conn) => new Promise((res, rej) => {
    conn.exec(`cat > ${path}` + (mode ? ` && chmod ${mode} ${path}` : ""), (err, stream) => {
      if (err) return rej(err);
      let errOut = "";
      stream.stderr.on("data", (d) => { errOut += d; });
      stream.on("close", (code) => {
        if (code !== 0) return rej(new Error(`write ${path} failed (exit ${code}): ${errOut}`));
        res();
      });
      stream.end(content);
    });
  }));
}

function end() { if (_conn) { _conn.end(); _conn = null; } }
function die(msg) { console.error(msg); process.exit(1); }
