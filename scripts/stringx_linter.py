import os
import sys
import glob
from collections import defaultdict

def parse_stringx(file_path):
    """Parse a stringx file into a dictionary."""
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Extract keys and values
    lines = content.splitlines()
    data = {}
    key = None
    multiline = False
    multiline_value = []

    for line in lines:
        line = line.strip()
        if multiline:
            if line.endswith('"""'):
                multiline_value.append(line.rstrip('"""'))
                data[key] = '\n'.join(multiline_value)
                multiline = False
                multiline_value = []
            else:
                multiline_value.append(line)
        elif '=' in line:
            key, value = map(str.strip, line.split('=', 1))
            key = key.strip('"')
            if value.startswith('"""'):
                multiline = True
                multiline_value.append(value.lstrip('"""'))
            else:
                data[key] = value.strip('"')
    
    return data

def write_stringx(file_path, data):
    """Write the dictionary back to a stringx file."""
    with open(file_path, 'w', encoding='utf-8') as file:
        for key in sorted(data.keys()):
            value = data[key].strip()
            if '\n' in value:
                file.write(f'"{key}" = """\n{value}\n"""\n\n')
            else:
                file.write(f'"{key}" = "{value}"\n\n')

def lint_stringx(folder_path):
    """Lint all stringx files in the folder."""
    files = glob.glob(os.path.join(folder_path, '*.stringx'))
    all_keys = set()
    file_data = {}

    # Parse all files
    for file in files:
        data = parse_stringx(file)
        file_data[file] = data
        all_keys.update(data.keys())
    
    # Identify missing keys
    missing_keys = defaultdict(list)
    for file, data in file_data.items():
        for key in all_keys:
            if key not in data:
                missing_keys[key].append(file)
    
    # Write sorted files
    for file, data in file_data.items():
        write_stringx(file, data)
    
    # Report missing keys
    print("Missing keys report:")
    for key, missing_files in missing_keys.items():
        print(f"{key}: Missing in {len(missing_files)} file(s):")
        for file in missing_files:
            print(f"  - {file}")

if __name__ == "__main__":
    lint_stringx("lang")
