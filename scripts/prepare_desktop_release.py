import os
import shutil
import sys

def build_project():
    os.system("mkdir -p game/assets")
    os.system("cp docs/game_icon.ico game/assets/game_icon.ico")
    os.system("cargo build --release")
    os.system("cargo build --package game --release --target x86_64-pc-windows-gnu")
    print("Build succeeded.")

def copy_directory(src, dest):
    if not os.path.exists(src):
        print(f"Source directory '{src}' does not exist. Skipping.")
        return
    shutil.copytree(src, dest, dirs_exist_ok=True)
    print(f"Copied '{src}' to '{dest}'.")

def remove_file(file_path):
    if os.path.exists(file_path):
        os.remove(file_path)
        print(f"Removed file '{file_path}'.")
    else:
        print(f"File '{file_path}' does not exist. Skipping removal.")

def copy_executable(source_executable, dest_executable):
    if not os.path.exists(source_executable):
        print(f"Executable '{source_executable}' does not exist. Skipping.")
        return
    shutil.copy2(source_executable, dest_executable)
    print(f"Copied executable to '{dest_executable}'.")

def main():
    build_project()

    platforms = {
        "macOS": {
            "executable_source": os.path.join("target", "release", "game"),
            "executable_dest": "SneakBit" 
        },
        "windows": {
            "executable_source": os.path.join("target", "x86_64-pc-windows-gnu", "release", "game.exe"),
            "executable_dest": "SneakBit.exe" 
        }
    }

    directories_to_copy = ["assets", "audio", "data", "lang", "fonts"]

    os.system("rm -rf __release")

    for platform_name, paths in platforms.items():
        platform_dir = os.path.join(f"__release", platform_name)        
        os.makedirs(platform_dir, exist_ok=True)
        print(f"Created directory '{platform_dir}'.")

        for directory in directories_to_copy:
            src = directory
            dest = os.path.join(platform_dir, directory)
            copy_directory(src, dest)

        save_json_path = os.path.join(platform_dir, "data", "save.json")
        remove_file(save_json_path)

        executable_source = paths["executable_source"]
        executable_dest = os.path.join(platform_dir, paths["executable_dest"])
        copy_executable(executable_source, executable_dest)

    print("Packaging completed successfully.")

if __name__ == "__main__":
    main()
