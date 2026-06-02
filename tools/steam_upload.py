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
#   npm run dist          # produces dist/{win-unpacked,linux-unpacked,mac*/SneakBit.app}
#   npm run steam         # this script
#
# Env overrides:
#   STEAMWORKS_BUILDER    path to steamworks-sdk ContentBuilder/builder_osx
#   STEAM_BRANCH          set-live branch (default: none — leaves build unset,
#                         so you promote it manually from the Steamworks UI)

import glob
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

    # mac dir is arch-suffixed (mac, mac-arm64, mac-universal). Find the one
    # that holds the .app bundle.
    mac_app = None
    for candidate in sorted(glob.glob(os.path.join(DIST_FOLDER, "mac*"))):
        apps = glob.glob(os.path.join(candidate, "*.app"))
        if apps:
            mac_app = candidate  # the dir containing the .app
            break

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
