import os

aseprite_path = "/Applications/Aseprite.app/Contents/MacOS/aseprite"
aseprite_assets = "aseprite"
pngs_folder = "assets"
number_of_frames = 4

# The HTML build consumes the *raw* per-frame biome strips (tiles_biome_raw1..N.png)
# and composes the neighbour-border variants at runtime (see js/renderer + js/assets.js).
# This script only exports the raw Aseprite frames; it no longer pre-bakes the giant
# border-combination lookup sheet the Rust core used to.
#
# Aseprite's {frame1} placeholder writes 1-indexed frame files straight to the final
# names, so the output is byte-identical to a plain Aseprite export (no PIL re-encode).

def export_biome_tiles(aseprite_assets, destination_folder):
    print("Exporting raw biome tile frames...")
    output = os.path.join(destination_folder, "tiles_biome_raw{frame1}.png")
    os.system(f"{aseprite_path} -b {aseprite_assets}/tiles_biome.aseprite --save-as \"{output}\"")

for frame in range(0, number_of_frames):
    os.system(f"rm -rf {pngs_folder}/tiles_biome_raw{frame + 1}.png")
export_biome_tiles(aseprite_assets, pngs_folder)
