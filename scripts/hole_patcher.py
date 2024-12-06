import json
import argparse
from pathlib import Path
import shutil
import sys
import logging
import fnmatch

def replace_zeros_with_twos(tiles):
    #CDEF -> 1
    modified_tiles = []
    changes_made = False
    for row in tiles:
        if 'C' in row or 'D' in row or 'E' in row or 'F' in row:
            modified_row = row.replace('C', '1').replace('D', '1').replace('E', '1').replace('F', '1')
            modified_tiles.append(modified_row)
            changes_made = True
        else:
            modified_tiles.append(row)
    return modified_tiles, changes_made

def process_file(file_path, create_backup=True):
    try:
        with file_path.open('r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        logging.error(f"JSON decode error in {file_path}: {e}")
        return False
    except Exception as e:
        logging.error(f"Error reading {file_path}: {e}")
        return False

    # Navigate to biome_tiles->tiles
    try:
        tiles = data['biome_tiles']['tiles']
        if not isinstance(tiles, list) or not all(isinstance(row, str) for row in tiles):
            logging.warning(f"Invalid 'tiles' format in {file_path}. Skipping.")
            return False
    except Exception as e:
        logging.warning(f"Missing key {e} in {file_path}. Skipping.")
        return False

    # Replace '0' with '2'
    modified_tiles, changes_made = replace_zeros_with_twos(tiles)

    if changes_made:
        if create_backup:
            backup_path = file_path.with_suffix(file_path.suffix + '.bak')
            try:
                shutil.copy2(file_path, backup_path)
                logging.info(f"Backup created: {backup_path}")
            except Exception as e:
                logging.error(f"Failed to create backup for {file_path}: {e}")
                return False

        # Update the tiles
        data['biome_tiles']['tiles'] = modified_tiles

        # Write back to the file
        try:
            with file_path.open('w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False, sort_keys=True)
            logging.info(f"Modified file: {file_path}")
            return True
        except Exception as e:
            logging.error(f"Error writing to {file_path}: {e}")
            return False
    else:
        logging.info(f"No '0's found in {file_path}.")
        return False

def scan_and_fix(directory, create_backup=True, filename_pattern="*.json"):
    modified_files = 0
    for file_path in directory.iterdir():
        if file_path.is_file() and fnmatch.fnmatch(file_path.name, filename_pattern):
            logging.debug(f"Processing file: {file_path}")
            if process_file(file_path, create_backup):
                modified_files += 1
            logging.debug("-" * 40)
    logging.info(f"Total modified files: {modified_files}")

def main():
    parser = argparse.ArgumentParser(
        description="Replace '0's with '2's in biome_tiles->tiles within JSON files."
    )
    parser.add_argument(
        'directory',
        type=Path,
        help='Path to the directory containing JSON files.'
    )
    parser.add_argument(
        '-b', '--backup',
        action='store_true',
        default=False,
        help='Create backup files before modifying (default: True).'
    )
    parser.add_argument(
        '-p', '--pattern',
        type=str,
        default="*.json",
        help='Filename pattern to match (e.g., "1*.json").'
    )
    parser.add_argument(
        '-v', '--verbose',
        action='store_true',
        help='Enable verbose logging.'
    )

    args = parser.parse_args()

    # Configure logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format='%(levelname)s: %(message)s'
    )

    if not args.directory.is_dir():
        logging.error(f"The specified path is not a directory: {args.directory}")
        sys.exit(1)

    scan_and_fix(
        directory=args.directory,
        create_backup=args.backup,
        filename_pattern=args.pattern
    )

if __name__ == "__main__":
    main()
