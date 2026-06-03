#!/usr/bin/env python3
"""Deploy the SneakBit server *and* static game client to its Ubuntu VPS.

Paramiko-based SSH, tar+SSH file push, SFTP for small config files, streaming
stdout/stderr to the local terminal. Idempotent.

What this does on the server:
  - Install nginx + certbot + Node.js (NodeSource 24.x) if missing.
  - Create a system user `sneakbit` and /opt/sneakbit-server/.
  - Push the server/ tree (index.js, package.json, ...) to /opt/sneakbit-server/.
  - Build the client (esbuild → _site/) and push it to /var/www/sneakbit.
  - Write the nginx vhost for sneakbit.curzel.it (static client at /, relay
    backend reverse-proxied on /ws + the JSON endpoints).
  - Provision TLS via certbot --nginx (idempotent).
  - Restart the service, reload nginx, and health-check the live URLs.

Usage:
    python3 deploy.py                          # incremental redeploy
    python3 deploy.py --commit "deploy note"   # git add -A + commit + push, then deploy
"""

from __future__ import annotations

import argparse
import os
import select
import shlex
import shutil
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / "venv"


def _bootstrap_venv() -> None:
    """Re-exec into ./venv/bin/python with paramiko installed. Homebrew Python
    on macOS blocks `pip install --user` (PEP 668), so a project-local venv is
    the only way to land a third-party dep without polluting the system."""
    venv_python = VENV / "bin" / "python"
    if not venv_python.exists():
        print(f"creating venv at {VENV}")
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV)])
        subprocess.check_call([str(venv_python), "-m", "pip",
                               "install", "--quiet", "--upgrade", "pip"])
    # Pin paramiko. 3.5.x is what the existing deployer was validated
    # against (May 2026); leave it pinned so a fresh checkout doesn't
    # silently pick up a breaking release. Bump deliberately, not by
    # accident.
    subprocess.check_call([str(venv_python), "-m", "pip",
                           "install", "--quiet", "paramiko==3.5.1"])
    os.execv(str(venv_python), [str(venv_python), str(ROOT / "deploy.py"),
                                *sys.argv[1:]])


try:
    import paramiko  # noqa: F401
except ImportError:
    _bootstrap_venv()
    import paramiko  # noqa: E402, F401


# ---- sneakbit server -------------------------------------------------------

APP_NAME = "sneakbit-server"
APP_USER = "sneakbit"
REMOTE_DIR = f"/opt/{APP_NAME}"
APP_BIND_HOST = "127.0.0.1"
APP_BIND_PORT = 8090
APP_BIND = f"{APP_BIND_HOST}:{APP_BIND_PORT}"
SERVER_NAME = "sneakbit.curzel.it"

# Static game client lives here, served by nginx at /. Kept under /var/www
# (owned by www-data) rather than the Node app dir under /opt — the two
# halves deploy independently and shouldn't share a tree.
WEBROOT = "/var/www/sneakbit"

# Rollback snapshots, taken just before the destructive client/server pushes.
# A failed health check restores from these so a broken build never stays
# live. WEBROOT_BAK mirrors the previous static client; SERVER_BAK_TAR holds
# the previous managed server code (data.db / editing/ excluded — they're
# runtime data, preserved across deploys regardless).
WEBROOT_BAK = WEBROOT + ".bak"
SERVER_BAK_TAR = f"{REMOTE_DIR}/.rollback-server.tgz"

LOCAL_SERVER_DIR = ROOT / "server"
SERVER_SYNC_PATHS = [
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
    # Accounts / auth feature. The SQLite DB (data.db) is created at runtime
    # under REMOTE_DIR and is NOT in this whitelist, so push_tree
    # (wipe_dirs=False) leaves it untouched across deploys.
    "db.js",
    "jwt.js",
    "passwords.js",
    "email.js",
    "httpBody.js",
    "authRoutes.js",
    "rateLimitHttp.js",
    "savesRoutes.js",
    "bearerAuth.js",
    # Creative-mode edited worlds (editor-only). The editing/ dir is created at
    # runtime under REMOTE_DIR and is NOT whitelisted here, so it survives
    # deploys the same way data.db does.
    "editors.js",
    "editingStore.js",
    "editingRoutes.js",
]

# node:sqlite (used by db.js) is stable/unflagged only on Node 24+. A redeploy
# after this bump re-runs the NodeSource setup_24.x step and restarts the unit.
NODE_MAJOR = "24"

# /etc/sneakbit-server.env — TURN env vars live here so the secret stays
# out of the repo. Format is a systemd EnvironmentFile (KEY=value, one per
# line). When TURN_SECRET / TURN_URLS are unset the relay's
# /turn-credentials endpoint returns 503 and clients use STUN only.
#
# To enable self-hosted TURN on this VPS:
#   1. apt install coturn
#   2. /etc/turnserver.conf:
#        listening-port=3478
#        tls-listening-port=5349
#        fingerprint
#        use-auth-secret
#        static-auth-secret=<same as TURN_SECRET below>
#        realm=sneakbit.curzel.it
#        # certbot cert for the relay subdomain works fine here:
#        cert=/etc/letsencrypt/live/sneakbit.curzel.it/fullchain.pem
#        pkey=/etc/letsencrypt/live/sneakbit.curzel.it/privkey.pem
#   3. /etc/default/coturn → TURNSERVER_ENABLED=1; systemctl restart coturn
#   4. ufw allow 3478,5349; ufw allow 49152:65535/udp   (relay range)
#   5. write /etc/sneakbit-server.env:
#        TURN_SECRET=<...>
#        TURN_URLS=turn:sneakbit.curzel.it:3478,turns:sneakbit.curzel.it:5349
#   6. systemctl restart sneakbit-server
# Restartborgo's nginx vhost is untouched by this — TURN/STUN run on
# their own ports.
TURN_ENV_FILE = "/etc/sneakbit-server.env"

# Server secrets propagated from the local .env into the systemd
# EnvironmentFile (TURN_ENV_FILE). Local .env is the single source of truth —
# keep server secrets there next to the deploy creds. Only keys actually
# present in .env are written, so an unset TURN simply omits those lines.
SERVER_ENV_KEYS = [
    "JWT_SECRET",
    "SMTP2GO_API_KEY",
    "SMTP_FROM",
    "TURN_SECRET",
    "TURN_URLS",
    # Optional comma-separated extension of the editor allowlist. The
    # hard-coded default (editors.js) already includes federico; this lets the
    # set grow from the VPS .env without a code change.
    "EDITOR_EMAILS",
]

def render_systemd_unit(git_sha: str) -> str:
    """Stamp the current git SHA into the unit at deploy time. The
    relay's /version endpoint reads $GIT_SHA at startup — baking it
    here means we don't need git on the VPS, and a redeploy without
    a server/ change still produces a fresh restart with the right
    SHA visible to ops. LOG_LEVEL defaults to info; override it via
    /etc/sneakbit-server.env if you need to crank up verbosity
    without redeploying."""
    return f"""[Unit]
Description=SneakBit game server (Node.js)
After=network.target

[Service]
Type=simple
User={APP_USER}
Group={APP_USER}
WorkingDirectory={REMOTE_DIR}
Environment=NODE_ENV=production
Environment=HOST={APP_BIND_HOST}
Environment=PORT={APP_BIND_PORT}
Environment=LOG_LEVEL=info
Environment=GIT_SHA={git_sha}
# Accounts/auth: data.db lives in the app dir (survives deploys — not in
# SERVER_SYNC_PATHS) and reset emails link to the public site. These two are
# non-secret, so they live inline; the secrets go in the EnvironmentFile
# below (written by step_server_env from the local .env) so they stay out of
# the repo and the systemd unit.
Environment=DATABASE_PATH={REMOTE_DIR}/data.db
Environment=APP_BASE_URL=https://{SERVER_NAME}
# Creative-mode edited worlds (one JSON file per zone). Like data.db this lives
# under the app dir and is NOT in SERVER_SYNC_PATHS, so edits survive deploys.
Environment=EDITING_DIR={REMOTE_DIR}/editing
# Secrets written by deploy.py (step_server_env) from local .env — see
# SERVER_ENV_KEYS. The leading '-' keeps a missing file non-fatal:
#   TURN_SECRET + TURN_URLS  — coturn; missing → relay falls back to STUN-only.
#   JWT_SECRET               — REQUIRED to enable accounts; absent → /auth/*
#                              returns 503 and the rest of the server runs
#                              unchanged (offline-first guarantee).
#   SMTP2GO_API_KEY+SMTP_FROM— forgot-password email; absent → the link is
#                              only logged, no email sent.
# LOG_LEVEL can be overridden here too if a live tweak is needed.
EnvironmentFile=-{TURN_ENV_FILE}
ExecStart=/usr/bin/node {REMOTE_DIR}/index.js
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
"""

# nginx vhost. Written HTTP-only first; certbot --nginx rewrites in place to
# add the TLS server block and the :80 -> :443 redirect.
#
# Serves two things off one host:
#   - the static game client (the esbuild bundle + assets/ + data/) at /,
#     from WEBROOT;
#   - the relay backend on a fixed set of paths, reverse-proxied to the Node
#     app. A single regex location covers them; the Upgrade headers it carries
#     are inert on the plain-HTTP endpoints (the $connection_upgrade map sets
#     Connection: close when the client didn't ask to upgrade).
# The ACME-challenge prefix and the backend regex don't overlap, so certbot's
# HTTP-01 challenge and its in-place TLS rewrite keep working untouched.
SNEAKBIT_NGINX_HTTP = f"""# Auto-generated by deploy.py. Static client + relay reverse proxy.
# certbot will rewrite this file to add the TLS server block.
server {{
    listen 80;
    listen [::]:80;
    server_name {SERVER_NAME};

    root {WEBROOT};
    index index.html;
    client_max_body_size 4m;

    location /.well-known/acme-challenge/ {{
        root /var/www/html;
    }}

    # Relay backend: WS upgrade + JSON endpoints. Regex beats the `/` prefix.
    # `auth/...` has a sub-path (/auth/register etc.), so it gets its own
    # prefix alternative rather than the `$`-anchored exact-match group.
    # `saves` is the cloud-save endpoint (GET/PUT/DELETE).
    location ~ ^/(ws|health|version|metrics|turn-credentials|auth/|saves) {{
        proxy_pass http://{APP_BIND};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1d;
        proxy_send_timeout 1d;
    }}

    # Static game client (hashed bundle, assets/, data/, index.html).
    location / {{
        try_files $uri $uri/ /index.html;
    }}
}}
"""

# nginx requires this map to set Connection: upgrade only when the client asked
# for an Upgrade. Without it, every plain HTTP request would also get the
# Upgrade header, which some clients reject.
NGINX_CONNECTION_UPGRADE_MAP = """# Auto-generated by deploy.py.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
"""

# ---- env / ssh helpers ----------------------------------------------------

def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip("'")
    for required in ("IP_ADDRESS", "SSH_USERNAME", "SSH_PASSWORD", "CERTBOT_EMAIL"):
        if required not in env:
            sys.exit(f"missing {required} in {path}")
    return env


_SSH_CLIENT: paramiko.SSHClient | None = None

# Pinned host keys (trust-on-first-use). Kept out of git (.gitignore) — it
# holds the VPS's public host key, pinned per deployer machine on the first
# connect. AutoAddPolicy alone silently trusted ANY key on EVERY connect, so
# a MITM on first connect could capture the root-capable SSH password; with a
# persistent known_hosts loaded, paramiko raises BadHostKeyException if the
# pinned key ever changes (real MITM — or a legitimate VPS reimage, in which
# case delete the stale line in this file to re-pin).
KNOWN_HOSTS = ROOT / ".deploy_known_hosts"


def _ssh_client(env: dict[str, str]) -> paramiko.SSHClient:
    global _SSH_CLIENT
    if _SSH_CLIENT is not None:
        transport = _SSH_CLIENT.get_transport()
        if transport is not None and transport.is_active():
            return _SSH_CLIENT
        _SSH_CLIENT.close()
        _SSH_CLIENT = None
    client = paramiko.SSHClient()
    # load_host_keys requires the file to exist and also makes AutoAddPolicy
    # PERSIST a newly-seen key here (pin on first use). A mismatched key is
    # rejected before the policy is consulted, so this is accept-new, not
    # blind-accept.
    KNOWN_HOSTS.touch(exist_ok=True)
    client.load_host_keys(str(KNOWN_HOSTS))
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=env["IP_ADDRESS"],
        username=env["SSH_USERNAME"],
        password=env["SSH_PASSWORD"],
        look_for_keys=False,
        allow_agent=False,
    )
    _SSH_CLIENT = client
    return client


def ssh(env: dict[str, str], cmd: str, *, check: bool = True,
        stdin_bytes: bytes | None = None) -> tuple[int, bytes, bytes]:
    print(f"  ssh> {cmd}", flush=True)
    client = _ssh_client(env)
    transport = client.get_transport()
    channel = transport.open_session()
    channel.exec_command(cmd)

    # Pump stdin on a background thread so the main thread can drain stdout/
    # stderr at the same time. Sending the whole payload up-front while NOT
    # reading output deadlocks once the remote writes back (or the SSH window
    # fills): the remote blocks on its own write, stops reading our stdin, and
    # our send() blocks forever. That's what left orphaned `tar -xzf -` procs
    # on the VPS and made every client upload "get stuck". paramiko channels
    # allow concurrent send/recv from different threads.
    stdin_error: list[BaseException] = []

    def _pump_stdin() -> None:
        try:
            if stdin_bytes:
                mv = memoryview(stdin_bytes)
                offset = 0
                while offset < len(mv):
                    n = channel.send(mv[offset:offset + 65536])
                    if n == 0:
                        break
                    offset += n
        except BaseException as exc:  # noqa: BLE001 — surfaced after join
            stdin_error.append(exc)
        finally:
            channel.shutdown_write()

    writer = threading.Thread(target=_pump_stdin, daemon=True)
    writer.start()

    stdout_buf = bytearray()
    stderr_buf = bytearray()

    def _drain() -> None:
        while channel.recv_ready():
            chunk = channel.recv(65536)
            if not chunk:
                break
            stdout_buf.extend(chunk)
            sys.stdout.write(chunk.decode("utf-8", errors="replace"))
            sys.stdout.flush()
        while channel.recv_stderr_ready():
            chunk = channel.recv_stderr(65536)
            if not chunk:
                break
            stderr_buf.extend(chunk)
            sys.stderr.write(chunk.decode("utf-8", errors="replace"))
            sys.stderr.flush()

    # Block in select (no busy-wait, no pinned CPU) until there's output to
    # read; the 0.5s cap guarantees we re-check exit status even when the
    # remote goes quiet for a while (apt, certbot, npm).
    while True:
        select.select([channel], [], [], 0.5)
        _drain()
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
    exit_code = channel.recv_exit_status()
    _drain()  # final flush — old code captured the trailing bytes but never printed them
    writer.join(timeout=5)
    channel.close()

    if stdin_error:
        raise RuntimeError(
            f"failed streaming stdin to remote: {cmd}"
        ) from stdin_error[0]

    if check and exit_code != 0:
        raise RuntimeError(
            f"remote command failed (exit {exit_code}): {cmd}\n"
            f"stderr: {stderr_buf.decode('utf-8', errors='replace')}"
        )
    return exit_code, bytes(stdout_buf), bytes(stderr_buf)


# Remote shell rsync uses for its transport. Matches the (password) auth model
# of the paramiko side and shares its pinned known_hosts file:
# StrictHostKeyChecking=accept-new pins the key on first use and then REJECTS a
# changed key (MITM, or a legit reimage — re-pin by deleting the stale line),
# instead of the old `no` + /dev/null which discarded the key and blindly
# accepted any server on every push. ConnectTimeout keeps a dead host from
# hanging the whole deploy.
RSYNC_SSH = (f"ssh -o StrictHostKeyChecking=accept-new "
             f"-o UserKnownHostsFile={shlex.quote(str(KNOWN_HOSTS))} "
             "-o ConnectTimeout=15")


def _rsync(env: dict[str, str], sources: list[str], dest: str, *,
           delete: bool = False) -> None:
    """Push local paths to user@host:dest over SSH with rsync.

    Replaces the previous in-band `tar | ssh 'tar -xzf -'` push, which fed a
    gzip stream into the remote's stdin over a paramiko channel and would
    intermittently stall mid-transfer (the symptom: deploy hangs during
    upload). rsync runs its own resilient, restartable transfer over a clean
    ssh channel and only sends changed blocks, so it's both faster on
    redeploys and doesn't share the stdin-window deadlock failure mode.

    Password auth is handed to the spawned ssh via sshpass `-e`, which reads it
    from $SSHPASS — so the secret never appears in argv or `ps`."""
    if not sources:
        return
    if shutil.which("sshpass") is None:
        sys.exit("sshpass not found on PATH — install it (brew install sshpass / "
                 "apt-get install sshpass); rsync push needs it for password auth")
    remote = f"{env['SSH_USERNAME']}@{env['IP_ADDRESS']}:{dest}"
    cmd = ["sshpass", "-e", "rsync", "-rlptz", "--timeout=60", "-e", RSYNC_SSH]
    if delete:
        cmd.append("--delete")
    cmd += [str(s) for s in sources]
    cmd.append(remote)
    proc_env = {**os.environ, "SSHPASS": env["SSH_PASSWORD"]}
    result = subprocess.run(cmd, env=proc_env)
    if result.returncode != 0:
        raise RuntimeError(f"rsync push failed (exit {result.returncode}) -> {remote}")


def push_tree(env: dict[str, str], root: Path, paths: list[str],
              remote_dir: str, *, wipe_dirs: bool = True) -> None:
    """rsync the whitelisted paths into remote_dir. No --delete: extra files
    already on the remote (data.db, editing/) are left untouched, matching the
    old wipe_dirs=False extract-on-top behaviour the callers rely on."""
    existing = [root / p for p in paths if (root / p).exists()]
    if not existing:
        print(f"  push> nothing to send under {root}, skipping")
        return
    ssh(env, f"install -d {shlex.quote(remote_dir)}")
    names = " ".join(p.name for p in existing)
    print(f"  push> {names} -> {remote_dir}/ (rsync)")
    _rsync(env, existing, f"{remote_dir}/")


def write_remote_file(env: dict[str, str], remote_path: str, content: str,
                      *, mode: int | None = None) -> None:
    print(f"  write> {remote_path} ({len(content)} bytes)")
    parent = str(Path(remote_path).parent).replace("\\", "/")
    ssh(env, f"install -d {shlex.quote(parent)}")
    client = _ssh_client(env)
    sftp = client.open_sftp()
    try:
        with sftp.file(remote_path, "wb") as fh:
            fh.write(content.encode("utf-8"))
        if mode is not None:
            sftp.chmod(remote_path, mode)
    finally:
        sftp.close()


# ---- local steps ----------------------------------------------------------

def step_git_commit_push(message: str) -> None:
    print(f"[git] commit + push: {message!r}")
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(ROOT), capture_output=True, text=True, check=True,
    ).stdout
    if status.strip():
        subprocess.check_call(["git", "add", "-A"], cwd=str(ROOT))
        subprocess.check_call(["git", "commit", "-m", message], cwd=str(ROOT))
    else:
        print("  working tree clean, skipping commit")
    subprocess.check_call(["git", "push", "-u", "origin", "HEAD"], cwd=str(ROOT))


def step_build_client():
    """Build the static client into _site/ via esbuild (npm run build).
    Run first so a broken build fails the deploy before we touch the VPS.

    esbuild is pinned to an EXACT version in package.json (no caret), so the
    bundle is reproducible regardless of when node_modules was installed — an
    `npm install` can't silently drift it to a newer 0.28.x. We deliberately
    don't `npm ci` here: that would reinstall the heavyweight Electron
    devDeps (whose postinstall downloads a binary) on every web deploy, a
    needless failure surface. If esbuild is missing, npm fails loudly —
    run `npm ci` once and retry."""
    print("[*] build client -> _site/")
    subprocess.check_call(["npm", "run", "build"], cwd=str(ROOT))


# ---- remote steps ---------------------------------------------------------

def step_sanity(env):
    print("[1] sanity")
    ssh(env, "hostname && uname -sr && cat /etc/os-release | head -2")


def step_apt(env):
    print(f"[2] apt install nginx + certbot + node {NODE_MAJOR}.x")
    ssh(env,
        "DEBIAN_FRONTEND=noninteractive apt-get update -qq && "
        "DEBIAN_FRONTEND=noninteractive apt-get install -qq -y "
        "nginx certbot python3-certbot-nginx ca-certificates curl gnupg rsync")
    ssh(env, "systemctl enable --now nginx")
    # NodeSource: idempotent. If `node --version` already matches our major,
    # skip the setup script (it's slow and noisy on every deploy).
    ssh(env, f"""
set -e
if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q '^v{NODE_MAJOR}\\.'; then
  echo "  installing node {NODE_MAJOR}.x via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_{NODE_MAJOR}.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -qq -y nodejs
else
  echo "  node $(node --version) already installed"
fi
""")


def step_user(env):
    print("[3] ensure system user " + APP_USER)
    ssh(env, (
        f"id -u {APP_USER} >/dev/null 2>&1 || "
        f"useradd --system --home {REMOTE_DIR} --shell /usr/sbin/nologin {APP_USER}"
    ))
    ssh(env, f"install -d -o {APP_USER} -g {APP_USER} -m 0755 {REMOTE_DIR}")


def step_backup_release(env):
    """Snapshot the currently-live client + server code BEFORE the destructive
    pushes, so a failed health check can roll back to the last known-good
    release rather than leaving a broken site live. The rsync --delete client
    push and the service restart are otherwise irreversible — the existing
    health checks only *detect* breakage after the fact.

    data.db and editing/ are runtime data (already preserved across deploys),
    so the server snapshot covers only the managed code files. On a first-ever
    deploy there's nothing to snapshot — handled gracefully (no backup → no
    rollback, which is correct: there's no previous release to fall back to)."""
    print("[*] snapshot current release (for rollback)")
    server_files = " ".join(shlex.quote(p) for p in SERVER_SYNC_PATHS)
    ssh(env, f"""
set -e
# Client: mirror the live WEBROOT (skip on a fresh host with no client yet).
rm -rf {shlex.quote(WEBROOT_BAK)}
if [ -d {shlex.quote(WEBROOT)} ] && [ -n "$(ls -A {shlex.quote(WEBROOT)} 2>/dev/null)" ]; then
  cp -a {shlex.quote(WEBROOT)} {shlex.quote(WEBROOT_BAK)}
fi
# Server: tar just the managed files that already exist (a fresh deploy has
# none yet). Build the list first so tar never errors on a missing path.
rm -f {shlex.quote(SERVER_BAK_TAR)}
if [ -d {shlex.quote(REMOTE_DIR)} ]; then
  present=""
  for f in {server_files}; do
    [ -e {shlex.quote(REMOTE_DIR)}/$f ] && present="$present $f"
  done
  if [ -n "$present" ]; then
    tar -C {shlex.quote(REMOTE_DIR)} -czf {shlex.quote(SERVER_BAK_TAR)} $present
  fi
fi
""")


def step_rollback(env):
    """Restore the snapshot taken by step_backup_release and restart the
    service. Best-effort: each half is guarded so a partial backup (e.g. a
    first deploy that had no client to snapshot) still restores what it can."""
    print("[!] rolling back to the previous release")
    ssh(env, f"""
set +e
if [ -d {shlex.quote(WEBROOT_BAK)} ]; then
  rm -rf {shlex.quote(WEBROOT)}
  cp -a {shlex.quote(WEBROOT_BAK)} {shlex.quote(WEBROOT)}
  chown -R www-data:www-data {shlex.quote(WEBROOT)}
  echo "  client restored from {WEBROOT_BAK}"
else
  echo "  no client snapshot to restore (first deploy?)"
fi
if [ -f {shlex.quote(SERVER_BAK_TAR)} ]; then
  tar -C {shlex.quote(REMOTE_DIR)} -xzf {shlex.quote(SERVER_BAK_TAR)}
  chown -R {APP_USER}:{APP_USER} {shlex.quote(REMOTE_DIR)}
  echo "  server code restored from {SERVER_BAK_TAR}"
else
  echo "  no server snapshot to restore (first deploy?)"
fi
systemctl restart {APP_NAME}
sleep 2
systemctl is-active {APP_NAME} && echo "  service active after rollback" || echo "  WARNING: service not active after rollback"
""")


def step_push_server(env):
    print("[4] push sneakbit-server tree")
    if not LOCAL_SERVER_DIR.exists():
        sys.exit(f"local server dir missing: {LOCAL_SERVER_DIR}")
    push_tree(env, LOCAL_SERVER_DIR, SERVER_SYNC_PATHS, REMOTE_DIR,
              wipe_dirs=False)
    ssh(env, f"chown -R {APP_USER}:{APP_USER} {REMOTE_DIR}")


def step_push_client(env):
    """Ship the built _site/ into WEBROOT. The bundle filename is content-
    hashed, so rsync with --delete to mirror the tree exactly — that drops
    stale app-*.js on every deploy without wiping and re-uploading the
    unchanged assets/ and data/ each time."""
    print(f"[*] push client -> {WEBROOT}")
    out = ROOT / "_site"
    if not (out / "index.html").exists():
        sys.exit("client build missing: run `npm run build` (step_build_client)")
    ssh(env, f"install -d -o www-data -g www-data {shlex.quote(WEBROOT)}")
    print(f"  push> _site/ -> {WEBROOT}/ (rsync --delete)")
    # Trailing slash on the source means "contents of _site/", not the dir
    # itself — so files land directly under WEBROOT.
    _rsync(env, [f"{out}/"], f"{WEBROOT}/", delete=True)
    ssh(env, f"chown -R www-data:www-data {shlex.quote(WEBROOT)}")


def _local_git_sha() -> str:
    """Best-effort local git SHA; falls back to 'unknown' if we're not
    in a git checkout (e.g. ran from a tarball). The server side will
    happily display whatever we send."""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=str(ROOT), text=True,
        ).strip()
    except Exception:
        return "unknown"


def step_server_env(env):
    """Write the systemd EnvironmentFile (TURN_ENV_FILE) from the secrets in
    local .env. Idempotent; runs before the service restart so the new
    process picks the values up. Owner root / mode 0600 — systemd reads it as
    root before dropping to the app user."""
    print("[4b] write server env file")
    lines = [f"{k}={env[k]}" for k in SERVER_ENV_KEYS if env.get(k)]
    if not lines:
        print("  no server secrets in .env, skipping (auth/email/TURN stay disabled)")
        return
    present = ", ".join(k for k in SERVER_ENV_KEYS if env.get(k))
    print(f"  writing {len(lines)} keys: {present}")
    write_remote_file(env, TURN_ENV_FILE, "\n".join(lines) + "\n", mode=0o600)


def step_systemd(env):
    print("[5] systemd unit")
    sha = _local_git_sha()
    print(f"  git_sha = {sha}")
    write_remote_file(env, f"/etc/systemd/system/{APP_NAME}.service",
                      render_systemd_unit(sha))
    ssh(env, "systemctl daemon-reload")


def step_nginx_http(env):
    """Write the HTTP-only vhost and reload nginx. Certbot upgrades it in
    place with a TLS server block in step_certs."""
    print("[6] write nginx vhost (http-only first)")
    ssh(env, "rm -f /etc/nginx/sites-enabled/default")
    ssh(env, "install -d -o www-data -g www-data /var/www/html")
    # Web root for the static client must exist before nginx -t / reload,
    # even if step_push_client hasn't populated it yet on a fresh host.
    ssh(env, f"install -d -o www-data -g www-data {shlex.quote(WEBROOT)}")

    # Ensure the connection-upgrade map exists in conf.d (loaded by main nginx.conf).
    write_remote_file(env,
                      "/etc/nginx/conf.d/connection_upgrade.conf",
                      NGINX_CONNECTION_UPGRADE_MAP)

    write_remote_file(env,
                      f"/etc/nginx/sites-available/{SERVER_NAME}",
                      SNEAKBIT_NGINX_HTTP)
    ssh(env,
        f"ln -sf /etc/nginx/sites-available/{SERVER_NAME} "
        f"/etc/nginx/sites-enabled/{SERVER_NAME}")
    ssh(env, "nginx -t && systemctl reload nginx")


def step_certs(env):
    """Use certbot --nginx to issue/renew the cert. Idempotent: if a cert
    already covers the names, certbot re-installs it without reissuing."""
    print("[7] certbot --nginx")
    email = env["CERTBOT_EMAIL"]
    ssh(env, (
        "certbot --nginx --non-interactive --agree-tos "
        f"--email {email} --redirect "
        f"-d {SERVER_NAME}"
    ))
    ssh(env, "nginx -t && systemctl reload nginx")


def step_service(env):
    print("[8] (re)start sneakbit-server")
    ssh(env, f"systemctl enable {APP_NAME} && systemctl restart {APP_NAME}")


def step_health(env):
    """Sanity-check the deploy end-to-end. Concentric rings:
      1. Service is active (catches crash-loop on startup).
      2. Plain HTTP endpoints respond locally and through nginx.
      3. https://host/ serves the static game client (not the relay's old
         "hello" string) — proves the static-root + location split landed.
      4. A real WS upgrade through nginx → relay returns 101 Switching
         Protocols. This catches the class of bugs where nginx serves /
         fine but the proxy_set_header Upgrade chain is broken (or a
         future config drops the websocket location). Without this we'd
         only learn at the next user join attempt.
      5. /version returns the SHA we just baked into the unit — proves
         the new binary actually started, not a leftover from a failed
         restart."""
    print("[9] health checks")
    ws_key = "dGhlIHNhbXBsZSBub25jZQ=="
    expected_sha = _local_git_sha()
    # The /version SHA gate is the only check that proves the *new* binary
    # started (not a leftover from a failed restart). It's only meaningful
    # when we actually know our SHA: off-git (tarball) deploys return
    # "unknown", and a bare `grep -q unknown` would match any /version body
    # containing that word — a vacuous pass. Skip the gate loudly instead,
    # and match with `grep -qF --` so the SHA is treated as a literal.
    if expected_sha == "unknown":
        print("  WARNING: local git SHA unknown (not a git checkout) — "
              "skipping the /version SHA gate")
        version_check = (
            f"sha=$(curl -fsSk https://{SERVER_NAME}/version) && "
            f"echo \"version:$sha (SHA gate skipped: local sha unknown)\" && "
        )
    else:
        version_check = (
            f"sha=$(curl -fsSk https://{SERVER_NAME}/version) && "
            f"echo \"version:$sha\" && "
            f"echo \"$sha\" | grep -qF -- '{expected_sha}' && "
        )
    ssh(env, (
        "sleep 2 && "
        f"systemctl is-active {APP_NAME} && "
        f"curl -fsS -o /dev/null -w 'local:%{{http_code}}\\n' http://{APP_BIND}/ && "
        f"curl -fsS -o /dev/null -w 'local-health:%{{http_code}}\\n' http://{APP_BIND}/health && "
        # https://host/ must now serve the built static client. Grep the
        # body for two markers: the canvas element (it's index.html, not the
        # relay's "hello" string) and the hashed bundle reference (the build
        # rewrite landed, not raw ./js/main.js).
        f"home=$(curl -fsSk https://{SERVER_NAME}/) && "
        f"echo \"$home\" | grep -q 'canvas id=' && "
        f"echo \"$home\" | grep -q 'app-' && "
        f"echo 'client:ok' && "
        # /version: must respond 200 and carry the git SHA we just baked.
        # We grep for the SHA explicitly — a stale process from a failed
        # restart would serve the old SHA and slip past a bare 200 check.
        # (Built above; the gate is skipped when our local SHA is unknown.)
        f"{version_check}"
        # /metrics: shape probe — must be valid JSON with the expected
        # top-level keys. Doesn't assert values; just that the endpoint
        # is wired through nginx and returning the snapshot.
        f"curl -fsSk https://{SERVER_NAME}/metrics | "
        f"  grep -q '\"connections\"' && "
        f"  echo 'metrics:ok' && "
        # WS upgrade through nginx. Must return HTTP/1.1 101 Switching
        # Protocols with a Sec-WebSocket-Accept header. Curl can't be
        # told "stop after the headers" for an upgrade, so we cap with
        # --max-time and silence stderr — head -1 only needs the first
        # line, and a missing/wrong line makes grep -q fail the chain.
        # The -f flag is deliberately NOT used: a successful 101 looks
        # like a server error to curl (status code >= 400 in its model)
        # and would otherwise exit non-zero.
        f"ws=$(curl -sk -i --http1.1 --max-time 3 "
        f"  -H 'Connection: Upgrade' -H 'Upgrade: websocket' "
        f"  -H 'Sec-WebSocket-Version: 13' "
        f"  -H 'Sec-WebSocket-Key: {ws_key}' "
        f"  -H 'Origin: https://curzel.it' "
        f"  https://{SERVER_NAME}/ws 2>/dev/null | head -1) ; "
        f"echo \"ws:$ws\" && "
        f"echo \"$ws\" | grep -q '101 Switching Protocols'"
    ))


def step_smoke(env):
    """Final post-deploy gate: run the local TLS smoke suite against
    the just-deployed relay. Exercises the real client→nginx→relay
    round-trip (handshake, host.open, guest.join failure path, ping)
    which the bash health gate above can't reach. Skipped if Node
    isn't installed locally — the deployer's machine might not have
    matching tooling, and the bash checks already cover the basics."""
    print("[10] tls smoke (local node --test against prod)")
    if subprocess.run(["which", "node"], stdout=subprocess.DEVNULL,
                      stderr=subprocess.DEVNULL).returncode != 0:
        print("  node not on PATH, skipping smoke")
        return
    smoke_url = f"wss://{SERVER_NAME}/ws"
    result = subprocess.run(
        ["node", "--test", "tests/server.smoke.test.js"],
        cwd=str(ROOT),
        env={**os.environ, "SMOKE_URL": smoke_url},
    )
    if result.returncode != 0:
        raise RuntimeError(f"smoke tests failed against {smoke_url}")


# ---- main -----------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--commit", metavar="MSG",
                        help="Stage all local changes, commit them with MSG, "
                             "and push the current branch before deploying.")
    args = parser.parse_args(argv)

    env = load_env(ROOT / ".env")

    if args.commit:
        step_git_commit_push(args.commit)
    step_build_client()
    step_sanity(env)
    step_apt(env)
    step_user(env)
    step_backup_release(env)  # snapshot before the destructive pushes below
    step_push_server(env)
    step_server_env(env)
    step_systemd(env)
    step_nginx_http(env)
    step_push_client(env)
    step_certs(env)
    step_service(env)
    # Health is the gate: if the freshly-deployed release is broken, restore
    # the snapshot rather than leaving it live, then fail the deploy.
    try:
        step_health(env)
    except Exception as e:
        print(f"\n[!] health check failed: {e}")
        try:
            step_rollback(env)
        except Exception as re:
            print(f"[!] rollback itself failed: {re}")
        print("\nDeploy FAILED — rolled back to the previous release.")
        return 1
    step_smoke(env)

    print(f"\nDone.")
    print(f"  https://{SERVER_NAME}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
