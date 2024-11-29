import keyring
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
    service_name = "Steam"
    saved_username = keyring.get_password(service_name, "username")
    
    if saved_username:
        print(f"Found saved credentials for {saved_username}.")
        use_saved = input("Would you like to use the saved credentials? (y/n): ").strip().lower()
        if use_saved == 'y':
            saved_password = keyring.get_password(service_name, saved_username)
            if saved_password:
                return saved_username, saved_password
            else:
                print("Password not found. Please re-enter your credentials.")
    
    print("Please log in to Steam.")
    username = input("Steam Username: ")
    password = getpass("Steam Password: ")
    
    save_credentials = input("Would you like to save these credentials to the macOS Keychain? (y/n): ").strip().lower()
    if save_credentials == 'y':
        keyring.set_password(service_name, "username", username)
        keyring.set_password(service_name, username, password)
        print("Credentials saved to macOS Keychain.")
    
    return username, password

def clear_steam_credentials():
    service_name = "Steam"
    try:
        saved_username = keyring.get_password(service_name, "username")
        keyring.delete_password(service_name, "username")
        keyring.delete_password(service_name, saved_username)
        print("Old credentials cleared")
    except Exception as e:
        print(f"An error occurred while clearing credentials: {e}")

def is_login_issue(e):
    s = f"{e}".lower()
    return "login" in s or "credentials" in s or "auth" in s

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
        if is_login_issue(e): clear_steam_credentials()
        raise
    except Exception as e:
        print("An unexpected error occurred:", e)
        if is_login_issue(e): clear_steam_credentials()
        raise

if __name__ == "__main__":
    main()
