import os
import subprocess
from getpass import getpass

BUILDER_OSX_PATH = "/Users/curzel/dev/steamworks-sdk/tools/ContentBuilder/builder_osx"
PROJECT_FOLDER = "/Users/curzel/dev/sneakbit"
TEMP_FOLDER = f"{PROJECT_FOLDER}/temp"
STEAM_BUILD_VDF = f"{TEMP_FOLDER}/build.vdf"
BUILD_CONTENT_ROOT = f"{TEMP_FOLDER}/build.vdf"

def steam_upload_script():
    upload_script = """
    "AppBuild"
    {
        "AppID" "3360860"
        "Desc" "Build %VERSION%"
        "BuildOutput" "%TEMP_FOLDER%"
        "ContentRoot" "%PROJECT_FOLDER%/__release"
        "Depots"
        {
            "3360861"
            {
                "FileMapping"
                {
                    "LocalPath" "windows/*"
                    "DepotPath" "."
                    "recursive" "1"
                }
            }
            "3360862"
            {
                "FileMapping"
                {
                    "LocalPath" "macOS/*"
                    "DepotPath" "."
                    "recursive" "1"
                }
            }
        }
    }
    """
    upload_script = upload_script.replace("%VERSION%", get_version())
    upload_script = upload_script.replace("%TEMP_FOLDER%", TEMP_FOLDER)
    upload_script = upload_script.replace("%PROJECT_FOLDER%", PROJECT_FOLDER)
    return upload_script

def get_version():
    cargo_toml_path = os.path.join("game", "Cargo.toml")
    with open(cargo_toml_path, "r") as f:
        for line in f:
            if line.strip().startswith("version"):
                return line.split("=")[1].strip().strip('"')
    raise ValueError("Version not found in Cargo.toml")

def get_steam_credentials():
    print("Please log in to Steam.")
    username = input("Steam Username: ")
    password = getpass("Steam Password: ")
    return username, password

def main():
    with open(STEAM_BUILD_VDF, "w") as f:
        f.write(steam_upload_script())
    
    steamcmd_path = os.path.join(BUILDER_OSX_PATH, "steamcmd")
    if not os.path.isfile(steamcmd_path):
        steamcmd_path = os.path.join(BUILDER_OSX_PATH, "Steam.AppBundle", "Steam", "Contents", "MacOS", "steamcmd")

    env = os.environ.copy()
    env["DYLD_LIBRARY_PATH"] = BUILDER_OSX_PATH
    env["DYLD_FRAMEWORK_PATH"] = BUILDER_OSX_PATH
    env["ULIMIT"] = "2048"
    
    username, password = get_steam_credentials()
    
    args = [
        steamcmd_path,
        "+login", username, password,
        "+run_app_build", STEAM_BUILD_VDF,
        "+quit"
    ]
    
    try:
        subprocess.run(args, check=True, env=env)
    except subprocess.CalledProcessError as e:
        print(f"SteamCMD failed with return code {e.returncode}")
        raise
    except Exception as e:
        print("An unexpected error occurred:", e)
        raise

if __name__ == "__main__":
    main()
