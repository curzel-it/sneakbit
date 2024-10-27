import os
import sys

path = sys.path[0]

os.system(f"python3 {path}/export_biome_tiles.py")
os.system(f"python3 {path}/export_constructions_tiles.py")
os.system(f"python3 {path}/export_sprite_sheets.py")
os.system(f"cp -r {path}/../assets/* {path}/../ios/Resources/assets")