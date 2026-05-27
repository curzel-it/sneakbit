#!/usr/bin/env python3
"""Deploy the SneakBit Node server to the shared VPS.

Shape borrowed from ~/dev/blabbers/deploy.py: paramiko-based SSH, tar+SSH
file push, SFTP for small config files, streaming stdout/stderr to the local
terminal. Idempotent.

What this does on the server:
  - First run only: purge the legacy blabbers Rust app (service, files, vhost).
  - Install nginx + certbot + Node.js (NodeSource 22.x) if missing.
  - Create a system user `sneakbit` and /opt/sneakbit-server/.
  - Push the server/ tree (index.js, package.json, ...) to /opt/sneakbit-server/.
  - Re-push ~/dev/restart static files to /var/www/restartborgo.it/ if present
    (the paying customer site — same contract as blabbers' deploy.py).
  - Write nginx vhosts for sneakbit.curzel.it + restartborgo.it.
  - Provision TLS for both domains via certbot --nginx (idempotent).
  - Restart the service, reload nginx, and health-check all live URLs.

restartborgo.it is a paying customer's static page on the same VPS. Every step
here is written so it survives — its vhost is rewritten from a stable template,
its cert is re-validated, and the final health check fails the deploy if it
stops returning 200. Do NOT add steps that remove vhosts or delete certs without
re-thinking that contract.

Usage:
    python3 deploy.py                          # incremental redeploy
    python3 deploy.py --commit "deploy note"   # git add -A + commit + push, then deploy
    python3 deploy.py --install-hook           # enable the post-commit auto-deploy hook
    python3 deploy.py --no-purge-blabbers      # skip the legacy purge step (after first run)
"""

from __future__ import annotations

import argparse
import io
import os
import shlex
import subprocess
import sys
import tarfile
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
    subprocess.check_call([str(venv_python), "-m", "pip",
                           "install", "--quiet", "paramiko"])
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
]

NODE_MAJOR = "22"

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
# Optional: TURN_SECRET + TURN_URLS live here once the operator wires
# coturn. Missing file is harmless — relay falls back to STUN-only.
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
SNEAKBIT_NGINX_HTTP = f"""# Auto-generated by deploy.py. Reverse proxy for sneakbit-server.
# certbot will rewrite this file to add the TLS server block.
server {{
    listen 80;
    listen [::]:80;
    server_name {SERVER_NAME};

    location /.well-known/acme-challenge/ {{
        root /var/www/html;
    }}

    client_max_body_size 4m;

    # WebSocket-friendly: keep Upgrade headers + long timeouts on every path.
    # Cheap insurance against future WS endpoints; doesn't change plain-HTTP behavior.
    location / {{
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

# ---- restartborgo static site (paying customer — preserve) ----------------

RESTART_DOMAIN = "restartborgo.it"
RESTART_WWW = "www.restartborgo.it"
RESTART_REMOTE_ROOT = f"/var/www/{RESTART_DOMAIN}"
RESTART_LOCAL_ROOT = Path.home() / "dev" / "restart"
RESTART_SYNC_PATHS = ["index.html", "styles.css", "assets"]

RESTART_NGINX_HTTP = f"""# Auto-generated by deploy.py. Static site for restartborgo.it.
# certbot --nginx will rewrite this file to add TLS.
server {{
    listen 80;
    listen [::]:80;
    server_name {RESTART_DOMAIN} {RESTART_WWW};

    root {RESTART_REMOTE_ROOT};
    index index.html;

    location /.well-known/acme-challenge/ {{
        root /var/www/html;
    }}

    location / {{
        try_files $uri $uri/ =404;
    }}
}}
"""

# ---- legacy blabbers (purge) ----------------------------------------------

LEGACY_BLABBERS_NAME = "blabbers"
LEGACY_BLABBERS_VHOST = "blabbers.curzel.it"
LEGACY_BLABBERS_DIR = "/opt/blabbers"


# ---- env / ssh helpers ----------------------------------------------------

def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip("'")
    for required in ("IP_ADDRESS", "SSH_USERNAME", "SSH_PASSWORD"):
        if required not in env:
            sys.exit(f"missing {required} in {path}")
    return env


_SSH_CLIENT: paramiko.SSHClient | None = None


def _ssh_client(env: dict[str, str]) -> paramiko.SSHClient:
    global _SSH_CLIENT
    if _SSH_CLIENT is not None:
        transport = _SSH_CLIENT.get_transport()
        if transport is not None and transport.is_active():
            return _SSH_CLIENT
        _SSH_CLIENT.close()
        _SSH_CLIENT = None
    client = paramiko.SSHClient()
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
    print(f"  ssh> {cmd}")
    client = _ssh_client(env)
    transport = client.get_transport()
    channel = transport.open_session()
    channel.exec_command(cmd)

    if stdin_bytes is not None:
        mv = memoryview(stdin_bytes)
        offset = 0
        while offset < len(mv):
            n = channel.send(mv[offset:offset + 65536])
            if n == 0:
                break
            offset += n
    channel.shutdown_write()

    stdout_buf = bytearray()
    stderr_buf = bytearray()
    while True:
        if channel.recv_ready():
            chunk = channel.recv(65536)
            if chunk:
                stdout_buf += chunk
                sys.stdout.write(chunk.decode("utf-8", errors="replace"))
                sys.stdout.flush()
        if channel.recv_stderr_ready():
            chunk = channel.recv_stderr(65536)
            if chunk:
                stderr_buf += chunk
                sys.stderr.write(chunk.decode("utf-8", errors="replace"))
                sys.stderr.flush()
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
    exit_code = channel.recv_exit_status()
    while channel.recv_ready():
        stdout_buf += channel.recv(65536)
    while channel.recv_stderr_ready():
        stderr_buf += channel.recv_stderr(65536)
    channel.close()

    if check and exit_code != 0:
        raise RuntimeError(
            f"remote command failed (exit {exit_code}): {cmd}\n"
            f"stderr: {stderr_buf.decode('utf-8', errors='replace')}"
        )
    return exit_code, bytes(stdout_buf), bytes(stderr_buf)


def _tarball(root: Path, paths: list[str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for p in paths:
            local = root / p
            if not local.exists():
                continue
            tar.add(str(local), arcname=p, recursive=True)
    return buf.getvalue()


def push_tree(env: dict[str, str], root: Path, paths: list[str],
              remote_dir: str, *, wipe_dirs: bool = True) -> None:
    existing = [p for p in paths if (root / p).exists()]
    if not existing:
        print(f"  push> nothing to send under {root}, skipping")
        return
    archive = _tarball(root, existing)
    dirs = [p for p in existing if (root / p).is_dir()]
    rm_clause = ""
    if wipe_dirs and dirs:
        rm_clause = " && rm -rf " + " ".join(
            shlex.quote(f"{remote_dir}/{p}") for p in dirs
        )
    remote_cmd = (
        f"set -e; install -d {shlex.quote(remote_dir)}"
        f"{rm_clause} && "
        f"tar -xzf - -C {shlex.quote(remote_dir)}"
    )
    print(f"  push> {' '.join(existing)} -> {remote_dir}/ ({len(archive)} bytes)")
    ssh(env, remote_cmd, stdin_bytes=archive)


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


# ---- remote steps ---------------------------------------------------------

def step_sanity(env):
    print("[1] sanity")
    ssh(env, "hostname && uname -sr && cat /etc/os-release | head -2")


def step_purge_blabbers(env):
    """Remove the legacy blabbers Rust service, its files, and its nginx vhost.
    Idempotent: every command tolerates the prior run having already cleaned
    things up. The TLS cert for blabbers.curzel.it is left in place — it does
    no harm and re-issuing it later is free."""
    print("[2] purge legacy blabbers app")
    ssh(env, f"""
set -e
if systemctl list-unit-files | grep -q '^{LEGACY_BLABBERS_NAME}\\.service'; then
  echo "  stopping + disabling {LEGACY_BLABBERS_NAME}.service"
  systemctl stop {LEGACY_BLABBERS_NAME} || true
  systemctl disable {LEGACY_BLABBERS_NAME} || true
  rm -f /etc/systemd/system/{LEGACY_BLABBERS_NAME}.service
  systemctl daemon-reload
fi
if [ -d {LEGACY_BLABBERS_DIR} ]; then
  echo "  removing {LEGACY_BLABBERS_DIR}"
  rm -rf {LEGACY_BLABBERS_DIR}
fi
if id -u {LEGACY_BLABBERS_NAME} >/dev/null 2>&1; then
  echo "  removing system user {LEGACY_BLABBERS_NAME}"
  userdel {LEGACY_BLABBERS_NAME} || true
fi
rm -f /etc/nginx/sites-enabled/{LEGACY_BLABBERS_VHOST}
rm -f /etc/nginx/sites-available/{LEGACY_BLABBERS_VHOST}
""")


def step_apt(env):
    print("[3] apt install nginx + certbot + node 22.x")
    ssh(env,
        "DEBIAN_FRONTEND=noninteractive apt-get update -qq && "
        "DEBIAN_FRONTEND=noninteractive apt-get install -qq -y "
        "nginx certbot python3-certbot-nginx ca-certificates curl gnupg")
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
    print("[4] ensure system user " + APP_USER)
    ssh(env, (
        f"id -u {APP_USER} >/dev/null 2>&1 || "
        f"useradd --system --home {REMOTE_DIR} --shell /usr/sbin/nologin {APP_USER}"
    ))
    ssh(env, f"install -d -o {APP_USER} -g {APP_USER} -m 0755 {REMOTE_DIR}")


def step_push_server(env):
    print("[5] push sneakbit-server tree")
    if not LOCAL_SERVER_DIR.exists():
        sys.exit(f"local server dir missing: {LOCAL_SERVER_DIR}")
    push_tree(env, LOCAL_SERVER_DIR, SERVER_SYNC_PATHS, REMOTE_DIR,
              wipe_dirs=False)
    ssh(env, f"chown -R {APP_USER}:{APP_USER} {REMOTE_DIR}")


def step_push_restart(env):
    """Re-push the restartborgo.it static site. Skipped (with a warning) if
    ~/dev/restart isn't present locally — the site is already deployed, so a
    missing local copy isn't fatal for sneakbit deploys."""
    print("[6] push restartborgo static site")
    if not RESTART_LOCAL_ROOT.exists():
        print(f"  WARNING: {RESTART_LOCAL_ROOT} not found locally — leaving "
              f"deployed restartborgo.it untouched (already live on the VPS)")
        return
    ssh(env, f"install -d -o www-data -g www-data -m 0755 {RESTART_REMOTE_ROOT}")
    push_tree(env, RESTART_LOCAL_ROOT, RESTART_SYNC_PATHS, RESTART_REMOTE_ROOT)
    ssh(env, f"chown -R www-data:www-data {RESTART_REMOTE_ROOT}")


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


def step_systemd(env):
    print("[7] systemd unit")
    sha = _local_git_sha()
    print(f"  git_sha = {sha}")
    write_remote_file(env, f"/etc/systemd/system/{APP_NAME}.service",
                      render_systemd_unit(sha))
    ssh(env, "systemctl daemon-reload")


def step_nginx_http(env):
    """Write HTTP-only vhosts for both sites and reload nginx. Certbot will
    upgrade these in place with TLS server blocks in step_certs."""
    print("[8] write nginx vhosts (http-only first)")
    ssh(env, "rm -f /etc/nginx/sites-enabled/default")
    ssh(env, "install -d -o www-data -g www-data /var/www/html")

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

    write_remote_file(env,
                      f"/etc/nginx/sites-available/{RESTART_DOMAIN}",
                      RESTART_NGINX_HTTP)
    ssh(env,
        f"ln -sf /etc/nginx/sites-available/{RESTART_DOMAIN} "
        f"/etc/nginx/sites-enabled/{RESTART_DOMAIN}")
    ssh(env, "nginx -t && systemctl reload nginx")


def step_certs(env):
    """Use certbot --nginx to issue/renew certs for both domains. Idempotent:
    if a cert already covers the names, certbot re-installs it without reissuing."""
    print("[9] certbot --nginx")
    ssh(env, (
        "certbot --nginx --non-interactive --agree-tos "
        "--email federico@curzel.it --redirect "
        f"-d {RESTART_DOMAIN} -d {RESTART_WWW}"
    ))
    ssh(env, (
        "certbot --nginx --non-interactive --agree-tos "
        "--email federico@curzel.it --redirect "
        f"-d {SERVER_NAME}"
    ))
    ssh(env, "nginx -t && systemctl reload nginx")


def step_service(env):
    print("[10] (re)start sneakbit-server")
    ssh(env, f"systemctl enable {APP_NAME} && systemctl restart {APP_NAME}")


def step_health(env):
    """Sanity-check the deploy end-to-end. Three concentric rings:
      1. Service is active (catches crash-loop on startup).
      2. Plain HTTP endpoints respond locally and through nginx.
      3. A real WS upgrade through nginx → relay returns 101 Switching
         Protocols. This catches the class of bugs where nginx serves /
         fine but the proxy_set_header Upgrade chain is broken (or a
         future config drops the websocket location). Without this we'd
         only learn at the next user join attempt.
      4. /version returns the SHA we just baked into the unit — proves
         the new binary actually started, not a leftover from a failed
         restart.

    restartborgo.it is the paying-customer co-tenant; if its TLS or vhost
    breaks during a sneakbit deploy this check fails before we move on."""
    print("[11] health checks")
    ws_key = "dGhlIHNhbXBsZSBub25jZQ=="
    expected_sha = _local_git_sha()
    ssh(env, (
        "sleep 2 && "
        f"systemctl is-active {APP_NAME} && "
        f"curl -fsS -o /dev/null -w 'local:%{{http_code}}\\n' http://{APP_BIND}/ && "
        f"curl -fsS -o /dev/null -w 'local-health:%{{http_code}}\\n' http://{APP_BIND}/health && "
        f"curl -fsSk -o /dev/null -w 'sneakbit:%{{http_code}}\\n' https://{SERVER_NAME}/ && "
        # /version: must respond 200 and carry the git SHA we just baked.
        # We grep for the SHA explicitly — a stale process from a failed
        # restart would serve the old SHA and slip past a bare 200 check.
        f"sha=$(curl -fsSk https://{SERVER_NAME}/version) && "
        f"echo \"version:$sha\" && "
        f"echo \"$sha\" | grep -q '{expected_sha}' && "
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
        f"echo \"$ws\" | grep -q '101 Switching Protocols' && "
        # restartborgo co-tenant must still serve.
        f"curl -fsSk -o /dev/null -w 'restartborgo:%{{http_code}}\\n' https://{RESTART_DOMAIN}/"
    ))


def step_smoke(env):
    """Final post-deploy gate: run the local TLS smoke suite against
    the just-deployed relay. Exercises the real client→nginx→relay
    round-trip (handshake, host.open, guest.join failure path, ping)
    which the bash health gate above can't reach. Skipped if Node
    isn't installed locally — the deployer's machine might not have
    matching tooling, and the bash checks already cover the basics."""
    print("[12] tls smoke (local node --test against prod)")
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


# ---- post-commit hook installer -------------------------------------------

def install_hook() -> int:
    hook_dir = ROOT / ".githooks"
    hook_path = hook_dir / "post-commit"
    if not hook_path.exists():
        sys.exit(f"hook missing: {hook_path} — is .githooks/post-commit checked in?")
    hook_path.chmod(0o755)
    subprocess.check_call(
        ["git", "config", "core.hooksPath", ".githooks"], cwd=str(ROOT)
    )
    print("installed: post-commit will auto-deploy when server/ or deploy.py change")
    print("  log:    /tmp/sneakbit-deploy.log")
    print("  unset: `git config --unset core.hooksPath` to disable")
    return 0


# ---- main -----------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--commit", metavar="MSG",
                        help="Stage all local changes, commit them with MSG, "
                             "and push the current branch before deploying.")
    parser.add_argument("--install-hook", action="store_true",
                        help="Enable the post-commit auto-deploy hook and exit.")
    parser.add_argument("--no-purge-blabbers", action="store_true",
                        help="Skip the legacy blabbers purge step.")
    args = parser.parse_args(argv)

    if args.install_hook:
        return install_hook()

    env = load_env(ROOT / ".env")

    if args.commit:
        step_git_commit_push(args.commit)
    step_sanity(env)
    if not args.no_purge_blabbers:
        step_purge_blabbers(env)
    step_apt(env)
    step_user(env)
    step_push_server(env)
    step_push_restart(env)
    step_systemd(env)
    step_nginx_http(env)
    step_certs(env)
    step_service(env)
    step_health(env)
    step_smoke(env)

    print(f"\nDone.")
    print(f"  https://{SERVER_NAME}/")
    print(f"  https://{RESTART_DOMAIN}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
