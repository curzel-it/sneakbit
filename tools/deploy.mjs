#!/usr/bin/env node
// Deploy the SneakBit server *and* static game client to its Ubuntu VPS.
//
// JS port of the former deploy.py. ssh2 (pure-JS, devDependency) replaces
// paramiko for SSH exec + SFTP; file pushes go over SFTP with rsync's default
// size+mtime quick-check, so there's no rsync/sshpass/OpenSSH dependency and
// it runs the same on macOS, Windows, and Linux. Idempotent.
//
// What this does on the server:
//   - Install nginx + certbot + Node.js (NodeSource 24.x) if missing.
//   - Create a system user `sneakbit` and /opt/sneakbit-server/.
//   - Push the server/ tree (index.js, package.json, ...) to /opt/sneakbit-server/.
//   - Build the client (esbuild -> _site/) and push it to /var/www/sneakbit.
//   - Write the nginx vhost for sneakbit.curzel.it (static client at /, relay
//     backend reverse-proxied on /ws + the JSON endpoints).
//   - Provision TLS via certbot --nginx (idempotent).
//   - Restart the service, reload nginx, and health-check the live URLs.
//
// Usage:
//   npm run deploy                                # incremental redeploy
//   npm run deploy -- --commit "deploy note"      # git add -A + commit + push, then deploy
//   (equivalently: node tools/deploy.mjs [--commit "..."])

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, readFileSync, writeFileSync, statSync, readdirSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let Client;
try {
  ({ Client } = require("ssh2"));
} catch {
  console.error(
    "ssh2 not installed — run `npm install` (it's a devDependency) and retry.",
  );
  process.exit(1);
}

// This script lives in tools/; the repo root (where .env, server/, _site/, and
// the git checkout live) is one level up.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- sneakbit server -------------------------------------------------------

const APP_NAME = "sneakbit-server";
const APP_USER = "sneakbit";
const REMOTE_DIR = `/opt/${APP_NAME}`;
const APP_BIND_HOST = "127.0.0.1";
const APP_BIND_PORT = 8090;
const APP_BIND = `${APP_BIND_HOST}:${APP_BIND_PORT}`;
const SERVER_NAME = "sneakbit.curzel.it";

// Static game client lives here, served by nginx at /. Kept under /var/www
// (owned by www-data) rather than the Node app dir under /opt — the two halves
// deploy independently and shouldn't share a tree.
const WEBROOT = "/var/www/sneakbit";

// Rollback snapshots, taken just before the destructive client/server pushes.
// A failed health check restores from these so a broken build never stays
// live. WEBROOT_BAK mirrors the previous static client; SERVER_BAK_TAR holds
// the previous managed server code (data.db / editing/ excluded — they're
// runtime data, preserved across deploys regardless).
const WEBROOT_BAK = WEBROOT + ".bak";
const SERVER_BAK_TAR = `${REMOTE_DIR}/.rollback-server.tgz`;

const LOCAL_SERVER_DIR = join(ROOT, "server");
const SERVER_SYNC_PATHS = [
  "index.js",
  "package.json",
  "wsFrames.js",
  "wsConnection.js",
  "wsExtensions.js",
  "sessions.js",
  "relay.js",
  "turnCredentials.js",
  "originAllowlist.js",
  "logger.js",
  "metrics.js",
  // Accounts / auth feature. The SQLite DB (data.db) is created at runtime
  // under REMOTE_DIR and is NOT in this whitelist, so the push leaves it
  // untouched across deploys.
  "db.js",
  "jwt.js",
  "passwords.js",
  "email.js",
  "httpBody.js",
  "authRoutes.js",
  "rateLimitHttp.js",
  "savesRoutes.js",
  "bearerAuth.js",
  // Real-money store (Stripe). package-lock.json ships too so `npm ci` on the
  // VPS installs the pinned `stripe` SDK (the server's first runtime dep).
  "package-lock.json",
  "stripe.js",
  "storeCatalog.js",
  "paymentsRoutes.js",
  "stripeWebhook.js",
  // Creative-mode edited worlds (editor-only). The editing/ dir is created at
  // runtime under REMOTE_DIR and is NOT whitelisted here, so it survives
  // deploys the same way data.db does.
  "editors.js",
  "editingStore.js",
  "editingRoutes.js",
];

// node:sqlite (used by db.js) is stable/unflagged only on Node 24+. A redeploy
// after this bump re-runs the NodeSource setup_24.x step and restarts the unit.
const NODE_MAJOR = "24";

// /etc/sneakbit-server.env — TURN env vars live here so the secret stays out of
// the repo. Format is a systemd EnvironmentFile (KEY=value, one per line). When
// TURN_SECRET / TURN_URLS are unset the relay's /turn-credentials endpoint
// returns 503 and clients use STUN only.
//
// To enable self-hosted TURN on this VPS:
//   1. apt install coturn
//   2. /etc/turnserver.conf:
//        listening-port=3478
//        tls-listening-port=5349
//        fingerprint
//        use-auth-secret
//        static-auth-secret=<same as TURN_SECRET below>
//        realm=sneakbit.curzel.it
//        # certbot cert for the relay subdomain works fine here:
//        cert=/etc/letsencrypt/live/sneakbit.curzel.it/fullchain.pem
//        pkey=/etc/letsencrypt/live/sneakbit.curzel.it/privkey.pem
//   3. /etc/default/coturn → TURNSERVER_ENABLED=1; systemctl restart coturn
//   4. ufw allow 3478,5349; ufw allow 49152:65535/udp   (relay range)
//   5. write /etc/sneakbit-server.env:
//        TURN_SECRET=<...>
//        TURN_URLS=turn:sneakbit.curzel.it:3478,turns:sneakbit.curzel.it:5349
//   6. systemctl restart sneakbit-server
// The co-tenant nginx vhost is untouched by this — TURN/STUN run on their own
// ports.
const TURN_ENV_FILE = "/etc/sneakbit-server.env";

// Server secrets propagated from the local .env into the systemd
// EnvironmentFile (TURN_ENV_FILE). Local .env is the single source of truth.
// Only keys actually present in .env are written, so an unset TURN simply omits
// those lines.
const SERVER_ENV_KEYS = [
  "JWT_SECRET",
  "SMTP2GO_API_KEY",
  "SMTP_FROM",
  "TURN_SECRET",
  "TURN_URLS",
  // Optional comma-separated extension of the editor allowlist. The hard-coded
  // default (editors.js) already includes federico; this lets the set grow
  // from the VPS .env without a code change.
  "EDITOR_EMAILS",
  // Real-money store (Stripe). When unset the payments endpoints stay disabled
  // (503) and the client hides the real-money tiles — same posture as JWT.
  // Start with sk_test_… + the test webhook signing secret, then rotate to live.
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

function renderSystemdUnit(gitSha) {
  // Stamp the current git SHA into the unit at deploy time. The relay's
  // /version endpoint reads $GIT_SHA at startup — baking it here means we don't
  // need git on the VPS, and a redeploy without a server/ change still produces
  // a fresh restart with the right SHA visible to ops.
  return `[Unit]
Description=SneakBit game server (Node.js)
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${REMOTE_DIR}
Environment=NODE_ENV=production
Environment=HOST=${APP_BIND_HOST}
Environment=PORT=${APP_BIND_PORT}
Environment=LOG_LEVEL=info
Environment=GIT_SHA=${gitSha}
Environment=DATABASE_PATH=${REMOTE_DIR}/data.db
Environment=APP_BASE_URL=https://${SERVER_NAME}
Environment=EDITING_DIR=${REMOTE_DIR}/editing
EnvironmentFile=-${TURN_ENV_FILE}
ExecStart=/usr/bin/node ${REMOTE_DIR}/index.js
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`;
}

// nginx vhost. Written HTTP-only first; certbot --nginx rewrites in place to
// add the TLS server block and the :80 -> :443 redirect.
const SNEAKBIT_NGINX_HTTP = `# Auto-generated by deploy.mjs. Static client + relay reverse proxy.
# certbot will rewrite this file to add the TLS server block.
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

    root ${WEBROOT};
    index index.html;
    client_max_body_size 4m;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Relay backend: WS upgrade + JSON endpoints. Regex beats the \`/\` prefix.
    # \`store\` is the real-money store API; \`webhooks/stripe\` is Stripe's
    # server-to-server callback (source of truth for entitlements) — both MUST
    # reach Node, never the static \`location /\` fallback.
    location ~ ^/(ws|health|version|metrics|turn-credentials|auth/|saves|store|webhooks/stripe) {
        proxy_pass http://${APP_BIND};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1d;
        proxy_send_timeout 1d;
    }

    # Static game client (hashed bundle, assets/, data/, index.html).
    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;

// nginx requires this map to set Connection: upgrade only when the client asked
// for an Upgrade. Without it, every plain HTTP request would also get the
// Upgrade header, which some clients reject.
const NGINX_CONNECTION_UPGRADE_MAP = `# Auto-generated by deploy.mjs.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
`;

// ---- env / ssh helpers ----------------------------------------------------

function loadEnv(path) {
  if (!existsSync(path)) die(`missing ${path}`);
  const env = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  for (const required of ["IP_ADDRESS", "SSH_USERNAME", "SSH_PASSWORD", "CERTBOT_EMAIL"]) {
    if (!(required in env)) die(`missing ${required} in ${path}`);
  }
  return env;
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

// Pinned host keys (trust-on-first-use). Kept out of git (.gitignore) — it
// holds the VPS's host-key fingerprint, pinned per deployer machine on the
// first connect. ssh2's hostVerifier is the only host-key gate, so without a
// pinned fingerprint a MITM on first connect could capture the root-capable
// SSH password; with a persistent pin we refuse to connect if the key ever
// changes (real MITM — or a legitimate VPS reimage, in which case delete the
// stale line in this file to re-pin). Format: one `host sha256base64` per line.
const KNOWN_HOSTS = join(ROOT, ".deploy_known_hosts");

function loadPinnedKey(host) {
  if (!existsSync(KNOWN_HOSTS)) return null;
  for (const raw of readFileSync(KNOWN_HOSTS, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [h, fp] = line.split(/\s+/);
    if (h === host && fp) return fp;
  }
  return null;
}

function pinKey(host, fingerprint) {
  const line = `${host} ${fingerprint}\n`;
  const existing = existsSync(KNOWN_HOSTS) ? readFileSync(KNOWN_HOSTS, "utf8") : "";
  writeFileSync(KNOWN_HOSTS, existing + line);
}

let _conn = null;

function connect(env) {
  if (_conn) return Promise.resolve(_conn);
  const host = env.IP_ADDRESS;
  return new Promise((res, rej) => {
    const conn = new Client();
    conn.on("ready", () => {
      _conn = conn;
      res(conn);
    });
    conn.on("error", rej);
    conn.connect({
      host,
      port: 22,
      username: env.SSH_USERNAME,
      password: env.SSH_PASSWORD,
      // TOFU host-key pinning. ssh2 hands us the raw host key; we fingerprint
      // it (sha256, base64) and compare against the pinned value — accept-new
      // on first sight, reject-on-change thereafter.
      hostVerifier: (key) => {
        const fp = createHash("sha256").update(key).digest("base64");
        const pinned = loadPinnedKey(host);
        if (pinned === null) {
          console.log(`  pinning host key for ${host}: SHA256:${fp}`);
          pinKey(host, fp);
          return true;
        }
        if (pinned !== fp) {
          console.error(
            `\n[!] HOST KEY MISMATCH for ${host}\n` +
            `    pinned:  SHA256:${pinned}\n` +
            `    offered: SHA256:${fp}\n` +
            `    Refusing to connect. If you reimaged the VPS, delete the stale ` +
            `line in ${KNOWN_HOSTS} and retry.`,
          );
          return false;
        }
        return true;
      },
    });
  });
}

// Run a remote command, streaming stdout/stderr to the local terminal as it
// arrives. Optionally feed `stdinBytes` to the remote's stdin. Resolves with
// {code, stdout, stderr}; rejects on a non-zero exit when check !== false.
function ssh(env, cmd, { check = true, stdinBytes = null } = {}) {
  console.log(`  ssh> ${cmd}`);
  return connect(env).then((conn) => new Promise((res, rej) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return rej(err);
      let out = "";
      let errOut = "";
      let exitCode = null;
      stream.on("data", (d) => {
        const s = d.toString("utf8");
        out += s;
        process.stdout.write(s);
      });
      stream.stderr.on("data", (d) => {
        const s = d.toString("utf8");
        errOut += s;
        process.stderr.write(s);
      });
      stream.on("exit", (code) => { exitCode = code; });
      stream.on("close", (code) => {
        const ec = code ?? exitCode ?? 0;
        if (check && ec !== 0) {
          return rej(new Error(
            `remote command failed (exit ${ec}): ${cmd}\nstderr: ${errOut}`,
          ));
        }
        res({ code: ec, stdout: out, stderr: errOut });
      });
      if (stdinBytes) stream.end(stdinBytes);
      else stream.end();
    });
  }));
}

function sftp(conn) {
  return new Promise((res, rej) => {
    conn.sftp((err, s) => (err ? rej(err) : res(s)));
  });
}

// Promisified SFTP primitives. Each tolerates the absence the caller expects
// (mkdir EEXIST, stat ENOENT) by resolving rather than throwing.
function sftpStat(s, path) {
  return new Promise((res) => s.stat(path, (err, attrs) => res(err ? null : attrs)));
}
function sftpMkdir(s, path) {
  return new Promise((res, rej) => s.mkdir(path, (err) =>
    (err && err.code !== 4 ? rej(err) : res())));
}
function sftpReaddir(s, path) {
  return new Promise((res) => s.readdir(path, (err, list) => res(err ? [] : list)));
}
function sftpUnlink(s, path) {
  return new Promise((res, rej) => s.unlink(path, (err) => (err ? rej(err) : res())));
}
function sftpRmdir(s, path) {
  return new Promise((res) => s.rmdir(path, () => res()));
}
function sftpFastPut(s, local, remote) {
  return new Promise((res, rej) => s.fastPut(local, remote, (err) => (err ? rej(err) : res())));
}
function sftpUtimes(s, path, atime, mtime) {
  return new Promise((res) => s.utimes(path, atime, mtime, () => res()));
}
function sftpWriteFile(s, path, data) {
  return new Promise((res, rej) => s.writeFile(path, data, (err) => (err ? rej(err) : res())));
}
function sftpChmod(s, path, mode) {
  return new Promise((res, rej) => s.chmod(path, mode, (err) => (err ? rej(err) : res())));
}

// rsync's default quick-check: skip the upload when the remote file exists and
// matches local size + mtime (whole-second precision). After uploading we stamp
// the remote mtime to the local one so the next deploy can skip it.
async function putFile(s, localPath, remotePath) {
  const lst = statSync(localPath);
  const lmtime = Math.floor(lst.mtimeMs / 1000);
  const rst = await sftpStat(s, remotePath);
  if (rst && rst.size === lst.size && rst.mtime === lmtime) {
    return false; // unchanged
  }
  await sftpFastPut(s, localPath, remotePath);
  await sftpUtimes(s, remotePath, lmtime, lmtime);
  return true;
}

// Ensure a remote directory (and ancestors) exist. Caches what it has made so a
// recursive sync doesn't re-stat the same parents repeatedly.
async function ensureRemoteDir(s, path, made) {
  if (path === "/" || path === "." || made.has(path)) return;
  await ensureRemoteDir(s, posix.dirname(path), made);
  await sftpMkdir(s, path);
  made.add(path);
}

function walkLocal(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkLocal(full, base, acc);
    else acc.push(relative(base, full).split(sep).join("/"));
  }
  return acc;
}

// Recursively delete remote entries under remoteRoot whose relative path isn't
// in `keep`. Mirrors rsync --delete: stale hashed bundles vanish on each deploy.
async function deleteExtraneous(s, remoteRoot, keep) {
  async function walk(remoteDir, relPrefix) {
    for (const entry of await sftpReaddir(s, remoteDir)) {
      const rel = relPrefix ? `${relPrefix}/${entry.filename}` : entry.filename;
      const remotePath = posix.join(remoteDir, entry.filename);
      const isDir = (entry.attrs.mode & 0o170000) === 0o040000;
      if (isDir) {
        await walk(remotePath, rel);
        await sftpRmdir(s, remotePath); // no-op unless now empty
      } else if (!keep.has(rel)) {
        await sftpUnlink(s, remotePath);
        console.log(`  delete> ${rel}`);
      }
    }
  }
  await walk(remoteRoot, "");
}

// Recursively sync a local directory's *contents* into remoteRoot over SFTP.
// With { del: true } it also removes remote files not present locally.
async function sftpSyncTree(conn, localRoot, remoteRoot, { del = false } = {}) {
  const s = await sftp(conn);
  const files = walkLocal(localRoot);
  const keep = new Set(files);
  const made = new Set();
  await ensureRemoteDir(s, remoteRoot, made);
  let sent = 0;
  for (const rel of files) {
    const remotePath = posix.join(remoteRoot, rel);
    await ensureRemoteDir(s, posix.dirname(remotePath), made);
    if (await putFile(s, join(localRoot, rel), remotePath)) sent++;
  }
  if (del) await deleteExtraneous(s, remoteRoot, keep);
  console.log(`  push> ${sent}/${files.length} changed -> ${remoteRoot}/`);
}

async function writeRemoteFile(conn, remotePath, content, { mode = null } = {}) {
  console.log(`  write> ${remotePath} (${Buffer.byteLength(content)} bytes)`);
  const s = await sftp(conn);
  const made = new Set();
  await ensureRemoteDir(s, posix.dirname(remotePath), made);
  await sftpWriteFile(s, remotePath, Buffer.from(content, "utf8"));
  if (mode !== null) await sftpChmod(s, remotePath, mode);
}

// ---- local steps ----------------------------------------------------------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: false, ...opts });
  if (r.error) throw r.error;
  return r.status ?? 0;
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// npm is a .cmd shim on Windows, and recent Node refuses to spawn .cmd/.bat
// without a shell — so route npm through the shell there.
const IS_WIN = process.platform === "win32";
function npm(args) {
  return run("npm", args, { shell: IS_WIN });
}

function stepGitCommitPush(message) {
  console.log(`[git] commit + push: ${JSON.stringify(message)}`);
  const status = capture("git", ["status", "--porcelain"]).stdout;
  if (status.trim()) {
    if (run("git", ["add", "-A"]) !== 0) die("git add failed");
    if (run("git", ["commit", "-m", message]) !== 0) die("git commit failed");
  } else {
    console.log("  working tree clean, skipping commit");
  }
  if (run("git", ["push", "-u", "origin", "HEAD"]) !== 0) die("git push failed");
}

function stepBuildClient() {
  // Build the static client into _site/ via esbuild (npm run build). Run first
  // so a broken build fails the deploy before we touch the VPS.
  console.log("[*] build client -> _site/");
  if (npm(["run", "build"]) !== 0) die("client build failed");
}

function localGitSha() {
  const r = capture("git", ["rev-parse", "HEAD"]);
  return r.status === 0 ? r.stdout.trim() : "unknown";
}

// ---- remote steps ---------------------------------------------------------

async function stepSanity(env) {
  console.log("[1] sanity");
  await ssh(env, "hostname && uname -sr && cat /etc/os-release | head -2");
}

async function stepApt(env) {
  console.log(`[2] apt install nginx + certbot + node ${NODE_MAJOR}.x`);
  await ssh(env,
    "DEBIAN_FRONTEND=noninteractive apt-get update -qq && " +
    "DEBIAN_FRONTEND=noninteractive apt-get install -qq -y " +
    "nginx certbot python3-certbot-nginx ca-certificates curl gnupg");
  await ssh(env, "systemctl enable --now nginx");
  // NodeSource: idempotent. If `node --version` already matches our major, skip
  // the setup script (it's slow and noisy on every deploy).
  await ssh(env, `
set -e
if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q '^v${NODE_MAJOR}\\.'; then
  echo "  installing node ${NODE_MAJOR}.x via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -qq -y nodejs
else
  echo "  node $(node --version) already installed"
fi
`);
}

async function stepUser(env) {
  console.log("[3] ensure system user " + APP_USER);
  await ssh(env,
    `id -u ${APP_USER} >/dev/null 2>&1 || ` +
    `useradd --system --home ${REMOTE_DIR} --shell /usr/sbin/nologin ${APP_USER}`);
  await ssh(env, `install -d -o ${APP_USER} -g ${APP_USER} -m 0755 ${REMOTE_DIR}`);
}

async function stepBackupRelease(env) {
  // Snapshot the currently-live client + server code BEFORE the destructive
  // pushes, so a failed health check can roll back to the last known-good
  // release. data.db and editing/ are runtime data (preserved across deploys),
  // so the server snapshot covers only the managed code files. On a first-ever
  // deploy there's nothing to snapshot — handled gracefully.
  console.log("[*] snapshot current release (for rollback)");
  const serverFiles = SERVER_SYNC_PATHS.join(" ");
  await ssh(env, `
set -e
rm -rf ${WEBROOT_BAK}
if [ -d ${WEBROOT} ] && [ -n "$(ls -A ${WEBROOT} 2>/dev/null)" ]; then
  cp -a ${WEBROOT} ${WEBROOT_BAK}
fi
rm -f ${SERVER_BAK_TAR}
if [ -d ${REMOTE_DIR} ]; then
  present=""
  for f in ${serverFiles}; do
    [ -e ${REMOTE_DIR}/$f ] && present="$present $f"
  done
  if [ -n "$present" ]; then
    tar -C ${REMOTE_DIR} -czf ${SERVER_BAK_TAR} $present
  fi
fi
`);
}

async function stepRollback(env) {
  // Restore the snapshot taken by stepBackupRelease and restart the service.
  // Best-effort: each half is guarded so a partial backup still restores what
  // it can.
  console.log("[!] rolling back to the previous release");
  await ssh(env, `
set +e
if [ -d ${WEBROOT_BAK} ]; then
  rm -rf ${WEBROOT}
  cp -a ${WEBROOT_BAK} ${WEBROOT}
  chown -R www-data:www-data ${WEBROOT}
  echo "  client restored from ${WEBROOT_BAK}"
else
  echo "  no client snapshot to restore (first deploy?)"
fi
if [ -f ${SERVER_BAK_TAR} ]; then
  tar -C ${REMOTE_DIR} -xzf ${SERVER_BAK_TAR}
  chown -R ${APP_USER}:${APP_USER} ${REMOTE_DIR}
  echo "  server code restored from ${SERVER_BAK_TAR}"
else
  echo "  no server snapshot to restore (first deploy?)"
fi
systemctl restart ${APP_NAME}
sleep 2
systemctl is-active ${APP_NAME} && echo "  service active after rollback" || echo "  WARNING: service not active after rollback"
`, { check: false });
}

async function stepPushServer(env, conn) {
  console.log("[4] push sneakbit-server tree");
  if (!existsSync(LOCAL_SERVER_DIR)) die(`local server dir missing: ${LOCAL_SERVER_DIR}`);
  const existing = SERVER_SYNC_PATHS.filter((p) => existsSync(join(LOCAL_SERVER_DIR, p)));
  if (!existing.length) {
    console.log(`  push> nothing to send under ${LOCAL_SERVER_DIR}, skipping`);
  } else {
    await ssh(env, `install -d ${REMOTE_DIR}`);
    const s = await sftp(conn);
    let sent = 0;
    for (const name of existing) {
      if (await putFile(s, join(LOCAL_SERVER_DIR, name), posix.join(REMOTE_DIR, name))) sent++;
    }
    console.log(`  push> ${sent}/${existing.length} changed -> ${REMOTE_DIR}/`);
  }
  await ssh(env, `chown -R ${APP_USER}:${APP_USER} ${REMOTE_DIR}`);
  // The server now has a runtime dependency (`stripe`), so install node_modules
  // on the VPS from the shipped package.json + lock. Previously the server was
  // zero-dep and this step didn't exist. `npm ci` is reproducible from the
  // lockfile; fall back to `npm install` if the lock is ever absent. --omit=dev
  // keeps it to runtime deps only. Idempotent — a no-op when nothing changed.
  console.log("[4a] install server dependencies (npm)");
  await ssh(env, `cd ${REMOTE_DIR} && (npm ci --omit=dev || npm install --omit=dev)`);
  await ssh(env, `chown -R ${APP_USER}:${APP_USER} ${REMOTE_DIR}`);
}

async function stepPushClient(env, conn) {
  // Ship the built _site/ into WEBROOT. The bundle filename is content-hashed,
  // so sync with delete to mirror the tree exactly — that drops stale app-*.js
  // on every deploy without re-uploading the unchanged assets/ and data/.
  console.log(`[*] push client -> ${WEBROOT}`);
  const out = join(ROOT, "_site");
  if (!existsSync(join(out, "index.html"))) {
    die("client build missing: run `npm run build` (stepBuildClient)");
  }
  await ssh(env, `install -d -o www-data -g www-data ${WEBROOT}`);
  await sftpSyncTree(conn, out, WEBROOT, { del: true });
  await ssh(env, `chown -R www-data:www-data ${WEBROOT}`);
}

async function stepServerEnv(env, conn) {
  // Write the systemd EnvironmentFile (TURN_ENV_FILE) from the secrets in local
  // .env. Idempotent; runs before the service restart so the new process picks
  // the values up. Owner root / mode 0600 — systemd reads it as root before
  // dropping to the app user.
  console.log("[4b] write server env file");
  const lines = SERVER_ENV_KEYS.filter((k) => env[k]).map((k) => `${k}=${env[k]}`);
  if (!lines.length) {
    console.log("  no server secrets in .env, skipping (auth/email/TURN stay disabled)");
    return;
  }
  const present = SERVER_ENV_KEYS.filter((k) => env[k]).join(", ");
  console.log(`  writing ${lines.length} keys: ${present}`);
  await writeRemoteFile(conn, TURN_ENV_FILE, lines.join("\n") + "\n", { mode: 0o600 });
}

async function stepSystemd(env, conn) {
  console.log("[5] systemd unit");
  const sha = localGitSha();
  console.log(`  git_sha = ${sha}`);
  await writeRemoteFile(conn, `/etc/systemd/system/${APP_NAME}.service`, renderSystemdUnit(sha));
  await ssh(env, "systemctl daemon-reload");
}

async function stepNginxHttp(env, conn) {
  // Write the HTTP-only vhost and reload nginx. Certbot upgrades it in place
  // with a TLS server block in stepCerts.
  console.log("[6] write nginx vhost (http-only first)");
  await ssh(env, "rm -f /etc/nginx/sites-enabled/default");
  await ssh(env, "install -d -o www-data -g www-data /var/www/html");
  // Web root for the static client must exist before nginx -t / reload, even if
  // stepPushClient hasn't populated it yet on a fresh host.
  await ssh(env, `install -d -o www-data -g www-data ${WEBROOT}`);
  await writeRemoteFile(conn, "/etc/nginx/conf.d/connection_upgrade.conf", NGINX_CONNECTION_UPGRADE_MAP);
  await writeRemoteFile(conn, `/etc/nginx/sites-available/${SERVER_NAME}`, SNEAKBIT_NGINX_HTTP);
  await ssh(env,
    `ln -sf /etc/nginx/sites-available/${SERVER_NAME} ` +
    `/etc/nginx/sites-enabled/${SERVER_NAME}`);
  await ssh(env, "nginx -t && systemctl reload nginx");
}

async function stepCerts(env) {
  // Use certbot --nginx to issue/renew the cert. Idempotent: if a cert already
  // covers the names, certbot re-installs it without reissuing.
  console.log("[7] certbot --nginx");
  await ssh(env,
    "certbot --nginx --non-interactive --agree-tos " +
    `--email ${env.CERTBOT_EMAIL} --redirect ` +
    `-d ${SERVER_NAME}`);
  await ssh(env, "nginx -t && systemctl reload nginx");
}

async function stepService(env) {
  console.log("[8] (re)start sneakbit-server");
  await ssh(env, `systemctl enable ${APP_NAME} && systemctl restart ${APP_NAME}`);
}

async function stepHealth(env) {
  // Sanity-check the deploy end-to-end. Concentric rings: service active ->
  // plain HTTP endpoints -> https serves the static client -> a real WS upgrade
  // through nginx returns 101 -> /version carries the SHA we just baked in.
  console.log("[9] health checks");
  const wsKey = "dGhlIHNhbXBsZSBub25jZQ==";
  const expectedSha = localGitSha();
  let versionCheck;
  if (expectedSha === "unknown") {
    console.log("  WARNING: local git SHA unknown (not a git checkout) — skipping the /version SHA gate");
    versionCheck =
      `sha=$(curl -fsSk https://${SERVER_NAME}/version) && ` +
      `echo "version:$sha (SHA gate skipped: local sha unknown)" && `;
  } else {
    versionCheck =
      `sha=$(curl -fsSk https://${SERVER_NAME}/version) && ` +
      `echo "version:$sha" && ` +
      `echo "$sha" | grep -qF -- '${expectedSha}' && `;
  }
  await ssh(env,
    "sleep 2 && " +
    `systemctl is-active ${APP_NAME} && ` +
    `curl -fsS -o /dev/null -w 'local:%{http_code}\\n' http://${APP_BIND}/ && ` +
    `curl -fsS -o /dev/null -w 'local-health:%{http_code}\\n' http://${APP_BIND}/health && ` +
    `home=$(curl -fsSk https://${SERVER_NAME}/) && ` +
    `echo "$home" | grep -q 'canvas id=' && ` +
    `echo "$home" | grep -q 'app-' && ` +
    `echo 'client:ok' && ` +
    versionCheck +
    `curl -fsSk https://${SERVER_NAME}/metrics | ` +
    `  grep -q '"connections"' && ` +
    `  echo 'metrics:ok' && ` +
    // Prove /store reaches Node, not the static `location /` fallback. The body
    // differs by config (items when enabled; payments_disabled/auth_unavailable
    // when not) but all three are JSON from the backend — index.html never is.
    `catalog=$(curl -sk https://${SERVER_NAME}/store/catalog) && ` +
    `echo "store:$catalog" && ` +
    `echo "$catalog" | grep -qE '"items"|payments_disabled|auth_unavailable' && ` +
    `echo 'store:routed' && ` +
    `ws=$(curl -sk -i --http1.1 --max-time 3 ` +
    `  -H 'Connection: Upgrade' -H 'Upgrade: websocket' ` +
    `  -H 'Sec-WebSocket-Version: 13' ` +
    `  -H 'Sec-WebSocket-Key: ${wsKey}' ` +
    `  -H 'Origin: https://curzel.it' ` +
    `  https://${SERVER_NAME}/ws 2>/dev/null | head -1) ; ` +
    `echo "ws:$ws" && ` +
    `echo "$ws" | grep -q '101 Switching Protocols'`);
}

function stepSmoke() {
  // Final post-deploy gate: run the local TLS smoke suite against the
  // just-deployed relay. Exercises the real client->nginx->relay round-trip
  // which the bash health gate can't reach. We're already running under Node,
  // so it's always available (no `which node` guard needed).
  console.log("[10] tls smoke (local node --test against prod)");
  const smokeUrl = `wss://${SERVER_NAME}/ws`;
  const status = run(process.execPath, ["--test", "tests/server.smoke.test.js"], {
    env: { ...process.env, SMOKE_URL: smokeUrl },
  });
  if (status !== 0) throw new Error(`smoke tests failed against ${smokeUrl}`);
}

// ---- main -----------------------------------------------------------------

function parseArgs(argv) {
  const args = { commit: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--commit") {
      args.commit = argv[++i];
      if (args.commit === undefined) die("--commit requires a message");
    } else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("Usage: npm run deploy [-- --commit \"deploy note\"]");
      process.exit(0);
    } else {
      die(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv(join(ROOT, ".env"));

  if (args.commit) stepGitCommitPush(args.commit);
  stepBuildClient();

  const conn = await connect(env);
  let exitCode = 0;
  try {
    await stepSanity(env);
    await stepApt(env);
    await stepUser(env);
    await stepBackupRelease(env); // snapshot before the destructive pushes below
    await stepPushServer(env, conn);
    await stepServerEnv(env, conn);
    await stepSystemd(env, conn);
    await stepNginxHttp(env, conn);
    await stepPushClient(env, conn);
    await stepCerts(env);
    await stepService(env);
    // Health is the gate: if the freshly-deployed release is broken, restore
    // the snapshot rather than leaving it live, then fail the deploy.
    try {
      await stepHealth(env);
    } catch (e) {
      console.log(`\n[!] health check failed: ${e.message}`);
      try {
        await stepRollback(env);
      } catch (re) {
        console.log(`[!] rollback itself failed: ${re.message}`);
      }
      console.log("\nDeploy FAILED — rolled back to the previous release.");
      exitCode = 1;
    }
    if (exitCode === 0) {
      stepSmoke();
      console.log("\nDone.");
      console.log(`  https://${SERVER_NAME}/`);
    }
  } finally {
    conn.end();
  }
  return exitCode;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`\n[!] deploy error: ${err?.stack ?? err}`);
  if (_conn) _conn.end();
  process.exit(1);
});
