import os
import shutil
import sys

def get_version():
    cargo_toml_path = os.path.join("game", "Cargo.toml")
    with open(cargo_toml_path, "r") as f:
        for line in f:
            if line.strip().startswith("version"):
                # Assumes the line is in the format: version = "1.2.3"
                return line.split("=")[1].strip().strip('"')
    raise ValueError("Version not found in Cargo.toml")

def build_project():
    build_command = "cargo build --release"
    result = os.system(build_command)
    if result != 0:
        print("Build failed.")
        sys.exit(1)
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

def copy_executable(version_dir):
    target_dir = os.path.join("target", "release")
    executable_name = f"game{executable_extension()}"
    src_executable = os.path.join(target_dir, executable_name)

    if not os.path.exists(src_executable):
        print(f"Executable '{src_executable}' does not exist. Build might have failed.")
        sys.exit(1)
        
    dest_executable = os.path.join(version_dir, f"SneakBit{executable_extension()}")
    shutil.copy2(src_executable, dest_executable)
    print(f"Copied executable to '{dest_executable}'.")

def main():
    build_project()
    version = get_version()
    print(f"Version: {version}")

    version_dir = version
    os.makedirs(version_dir, exist_ok=True)
    print(f"Created directory '{version_dir}'.")

    # List of directories to copy
    directories_to_copy = ["assets", "audio", "data", "lang", "fonts"]
    for directory in directories_to_copy:
        src = directory
        dest = os.path.join(version_dir, directory)
        copy_directory(src, dest)

    # Remove data/save.json if it exists
    save_json_path = os.path.join(version_dir, "data", "save.json")
    remove_file(save_json_path)

    # Determine the executable name based on the OS
    copy_executable(version_dir)

    print("Packaging completed successfully.")

def executable_extension():
    if sys.platform.startswith("win"):
        return ".exe"
    else:
        return ""
    
if __name__ == "__main__":
    main()
