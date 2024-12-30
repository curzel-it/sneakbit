import os

tile_size = 16
aseprite_path = "/Applications/Aseprite.app/Contents/MacOS/aseprite"
biomes = "grass desert rock snow water".split(" ")
aseprite_assets = "aseprite"
pngs_folder = "assets"

def export_construction_tiles(aseprite_assets, destination_folder):
    os.system(f"{aseprite_path} -b {aseprite_assets}/tiles_constructions.aseprite --save-as {destination_folder}/tiles_constructions.png")

os.system(f"rm -rf {pngs_folder}/tiles_constructions.png")
export_construction_tiles(aseprite_assets, pngs_folder)