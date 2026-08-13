#!/usr/bin/env python3
# Upload the packaged Electron build to Steam via steamcmd / ContentBuilder.
#
# Ported from the original Rust build's scripts/steampipe.py (see
# `git show rust-core-tip:scripts/steampipe.py`). Same AppID (3360860) and
# depots (3360861 win / 3360862 mac / 3360863 linux), same steamcmd +
# macOS-keychain credential flow. Two things changed for the HTML/Electron
# build:
#   1. version comes from package.json, not Cargo.toml;
#   2. depot ContentRoot is electron-builder's `--dir` output (run `npm run
#      dist` first), with the per-platform unpacked folders auto-detected.
#
# Usage:
#   npm run dist            # produces dist/{win-unpacked,linux-unpacked,mac*/SneakBit.app}
#   npm run steam           # this script — uploads, promotes nothing
#   npm run steam:smoketest # uploads and sets it live on the smoketest branch
#
# Env overrides:
#   STEAMWORKS_BUILDER    path to steamworks-sdk ContentBuilder/builder_osx
#   STEAM_BRANCH          set-live branch (default: none — leaves build unset,
#                         so you promote it manually from the Steamworks UI).
#                         Steam rejects SetLive on the default branch, so this
#                         only ever targets a beta branch; shipping to everyone
#                         stays a deliberate click in the Steamworks UI.

import glob
import hashlib
import json
import os
import subprocess
import sys
from getpass import getpass

try:
    import keyring
except ImportError:
    keyring = None

APP_ID = "3360860"
DEPOT_WINDOWS = "3360861"
DEPOT_MACOS = "3360862"
DEPOT_LINUX = "3360863"

PROJECT_FOLDER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_FOLDER = os.path.join(PROJECT_FOLDER, "dist")
TEMP_FOLDER = os.path.join(PROJECT_FOLDER, "temp")
STEAM_BUILD_VDF = os.path.join(TEMP_FOLDER, "build.vdf")

DEFAULT_BUILDER_OSX = os.path.expanduser(
    "~/dev/steamworks-sdk/tools/ContentBuilder/builder_osx"
)
BUILDER_OSX_PATH = os.environ.get("STEAMWORKS_BUILDER", DEFAULT_BUILDER_OSX)


def get_version():
    with open(os.path.join(PROJECT_FOLDER, "package.json"), "r") as f:
        pkg = json.load(f)
    version = pkg.get("version")
    if not version:
        raise ValueError("No 'version' in package.json")
    return version


def find_dist_dirs():
    """Locate electron-builder --dir output. Returns (win, mac, linux) paths
    relative to DIST_FOLDER, or raises if any platform is missing."""
    win = os.path.join(DIST_FOLDER, "win-unpacked")
    linux = os.path.join(DIST_FOLDER, "linux-unpacked")

    # mac dir is arch-suffixed (mac, mac-arm64, mac-universal). Take the most
    # recently built one: switching arch leaves the previous arch's folder
    # sitting in dist/, and picking it would silently ship a stale build.
    mac_candidates = [
        d
        for d in glob.glob(os.path.join(DIST_FOLDER, "mac*"))
        if os.path.isdir(d) and glob.glob(os.path.join(d, "*.app"))
    ]
    mac_candidates.sort(key=os.path.getmtime, reverse=True)
    mac_app = mac_candidates[0] if mac_candidates else None
    if len(mac_candidates) > 1:
        others = ", ".join(os.path.basename(d) for d in mac_candidates[1:])
        print(
            "Warning: several mac build folders in dist/. Using the newest "
            "(%s), ignoring: %s. Run `npm run dist` to rebuild from clean."
            % (os.path.basename(mac_app), others)
        )

    missing = []
    if not os.path.isdir(win):
        missing.append("win-unpacked")
    if not os.path.isdir(linux):
        missing.append("linux-unpacked")
    if not mac_app:
        missing.append("mac*/<App>.app")
    if missing:
        raise FileNotFoundError(
            "Missing dist output: %s. Run `npm run dist` first." % ", ".join(missing)
        )

    return (
        os.path.relpath(win, DIST_FOLDER),
        os.path.relpath(mac_app, DIST_FOLDER),
        os.path.relpath(linux, DIST_FOLDER),
    )


def find_asar(platform_dir):
    """The app.asar inside a packaged platform folder, or None."""
    direct = os.path.join(platform_dir, "resources", "app.asar")
    if os.path.isfile(direct):
        return direct
    inside_bundle = glob.glob(
        os.path.join(platform_dir, "*.app", "Contents", "Resources", "app.asar")
    )
    return inside_bundle[0] if inside_bundle else None


def assert_same_build(win_rel, mac_rel, linux_rel):
    """Refuse to upload platform folders that came from different builds.

    A single `npm run dist` packs the same files into every platform's
    app.asar, so all three are byte-identical. They diverge only when
    electron-builder is run for a subset of platforms over an existing dist/,
    which leaves the other platforms' folders behind from an earlier run for
    this script to re-upload verbatim.

    That failure is invisible without this check: the upload log reports
    success for all three depots, and Steam dedupes the unchanged content away
    rather than shipping anything, so a fix silently never reaches players. It
    cost two rounds of debugging a binary that did not contain the fix under
    test (see docs/linux-steam-sandbox.md).
    """
    digests = {}
    for label, rel in (("windows", win_rel), ("macOS", mac_rel), ("linux", linux_rel)):
        asar = find_asar(os.path.join(DIST_FOLDER, rel))
        if not asar:
            raise FileNotFoundError(
                "No app.asar under dist/%s. Run `npm run dist` first." % rel
            )
        with open(asar, "rb") as f:
            digests[label] = hashlib.sha256(f.read()).hexdigest()

    if len(set(digests.values())) > 1:
        detail = "\n".join(
            "  %-8s %s  (dist/%s)" % (label, digests[label][:16], rel)
            for label, rel in (("windows", win_rel), ("macOS", mac_rel), ("linux", linux_rel))
        )
        raise RuntimeError(
            "Platform folders are from different builds — their app.asar files "
            "disagree:\n%s\nRun `npm run dist` to rebuild all three from clean."
            % detail
        )


def steam_upload_script(version, win_rel, mac_rel, linux_rel):
    # ContentRoot is dist/; LocalPaths are relative to it. `*` recursive keeps
    # the platform folder structure (notably the macOS .app bundle wrapper).
    desc = "Build %s" % version
    set_live = os.environ.get("STEAM_BRANCH", "")
    set_live_line = ('    "SetLive" "%s"\n' % set_live) if set_live else ""
    return f"""
"AppBuild"
{{
    "AppID" "{APP_ID}"
    "Desc" "{desc}"
{set_live_line}    "BuildOutput" "{TEMP_FOLDER}"
    "ContentRoot" "{DIST_FOLDER}"
    "Depots"
    {{
        "{DEPOT_WINDOWS}"
        {{
            "FileMapping"
            {{
                "LocalPath" "{win_rel}/*"
                "DepotPath" "."
                "recursive" "1"
            }}
        }}
        "{DEPOT_MACOS}"
        {{
            "FileMapping"
            {{
                "LocalPath" "{mac_rel}/*"
                "DepotPath" "."
                "recursive" "1"
            }}
        }}
        "{DEPOT_LINUX}"
        {{
            "FileMapping"
            {{
                "LocalPath" "{linux_rel}/*"
                "DepotPath" "."
                "recursive" "1"
            }}
        }}
    }}
}}
"""


def get_steam_credentials():
    service_name = "Steam"
    if keyring:
        saved_username = keyring.get_password(service_name, "username")
        if saved_username:
            print(f"Found saved credentials for {saved_username}.")
            if input("Use saved credentials? (y/n): ").strip().lower() == "y":
                saved_password = keyring.get_password(service_name, saved_username)
                if saved_password:
                    return saved_username, saved_password
                print("Password not found. Please re-enter your credentials.")

    print("Please log in to Steam.")
    username = input("Steam Username: ")
    password = getpass("Steam Password: ")

    if keyring and input("Save to macOS Keychain? (y/n): ").strip().lower() == "y":
        keyring.set_password(service_name, "username", username)
        keyring.set_password(service_name, username, password)
        print("Credentials saved to macOS Keychain.")

    return username, password


def clear_steam_credentials():
    if not keyring:
        return
    service_name = "Steam"
    try:
        saved_username = keyring.get_password(service_name, "username")
        keyring.delete_password(service_name, "username")
        if saved_username:
            keyring.delete_password(service_name, saved_username)
        print("Old credentials cleared")
    except Exception as e:
        print(f"An error occurred while clearing credentials: {e}")


def is_login_issue(e):
    s = f"{e}".lower()
    return "login" in s or "credentials" in s or "auth" in s


def main():
    version = get_version()
    win_rel, mac_rel, linux_rel = find_dist_dirs()
    assert_same_build(win_rel, mac_rel, linux_rel)
    print(f"Uploading SneakBit {version} to Steam (AppID {APP_ID})")
    print(f"  windows: dist/{win_rel}")
    print(f"  macOS:   dist/{mac_rel}")
    print(f"  linux:   dist/{linux_rel}")

    os.makedirs(TEMP_FOLDER, exist_ok=True)
    with open(STEAM_BUILD_VDF, "w") as f:
        f.write(steam_upload_script(version, win_rel, mac_rel, linux_rel))

    steamcmd_path = os.path.join(BUILDER_OSX_PATH, "steamcmd")
    if not os.path.isfile(steamcmd_path):
        steamcmd_path = os.path.join(
            BUILDER_OSX_PATH, "Steam.AppBundle", "Steam", "Contents", "MacOS", "steamcmd"
        )
    if not os.path.isfile(steamcmd_path):
        print(f"steamcmd not found under {BUILDER_OSX_PATH}.")
        print("Set STEAMWORKS_BUILDER to your ContentBuilder/builder_osx path.")
        sys.exit(1)

    env = os.environ.copy()
    env["DYLD_LIBRARY_PATH"] = BUILDER_OSX_PATH
    env["DYLD_FRAMEWORK_PATH"] = BUILDER_OSX_PATH
    env["ULIMIT"] = "2048"

    username, password = get_steam_credentials()

    args = [
        steamcmd_path,
        "+login", username, password,
        "+run_app_build", STEAM_BUILD_VDF,
        "+quit",
    ]

    try:
        subprocess.run(args, check=True, env=env)
    except subprocess.CalledProcessError as e:
        print(f"SteamCMD failed with return code {e.returncode}")
        if is_login_issue(e):
            clear_steam_credentials()
        raise
    except Exception as e:
        print("An unexpected error occurred:", e)
        if is_login_issue(e):
            clear_steam_credentials()
        raise


if __name__ == "__main__":
    main()
