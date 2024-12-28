import pdb
from PIL import Image
import sys
import os
import subprocess

tile_size = 16
aseprite_path = "/Applications/Aseprite.app/Contents/MacOS/aseprite"
biomes = "grass desert rock snow water".split(" ")
aseprite_assets = "aseprite"
pngs_folder = "assets"

combinations = {
    "n": (4, -90),
    "e": (4, 180),
    "s": (4, 90),
    "w": (4, 0),
    "nw": (3, 0),
    "ne": (3, -90),
    "es": (3, 180),
    "sw": (3, 90),
    "nes": (2, 180),
    "esw": (2, 90),
    "nws": (2, 0),
    "nwe": (2, -90),
    "nesw": (1, 0),
    "ns": (4, (-90, 90)),
    "ew": (4, (180, 0))
}

def fix_rgba_image(image_path):
    image = Image.open(image_path)
    
    if image.mode != 'RGBA':
        print(f"Converting {image_path} to RGBA")
        image = image.convert("RGBA")        
        image.save(image_path)
    else:
        r, g, b, a = image.split()
        if a.getextrema() == (255, 255):
            print(f"No transparency detected in {image_path}. Fixing alpha channel.")
            image = Image.merge("RGBA", (r, g, b, a))
            image.save(image_path)

def export_biome_tiles(aseprite_assets, destination_folder):
    print("Generating tiles...")
    os.system("rm -rf temp")
    os.system("mkdir temp")

    os.system(f"{aseprite_path} -b {aseprite_assets}/tiles_biome.aseprite --save-as temp/tiles_biome-0.png")
        
    for file in os.listdir("temp"):
        if file.endswith(".png"):
            fix_rgba_image(f"temp/{file}")    

    number_of_frames = 4
    biomes = [
        "Nothing",
        "Grass",
        "Water",
        "Rock",
        "Desert",
        "Snow",
        "DarkWood",
        "LightWood",
        "DarkRock",
        "Ice",
        "DarkGrass",
        "RockPlates",
        "Lava",
        "Farmland",
        "DarkWater",
        "DarkSand",
        "SandPlates"
    ]

    w = len(combinations) * len(biomes) + 1
    h = len(biomes) * number_of_frames
    overall = Image.new("RGBA", (tile_size * w, tile_size * h), (0, 0, 0, 255))
    overall_y = 0

    for frame in range(0, number_of_frames):
        tiles = Image.open(f"temp/tiles_biome-{frame}.png")

        for (biome_index, base_biome) in enumerate(biomes):
            overall_y = biome_index + len(biomes) * frame
            y = tile_size * biome_index
            base = tiles.crop((0, y, tile_size, y + tile_size))
            overall_x = 0
            overall.paste(base, (overall_x * tile_size, overall_y * tile_size)) 

            for (other_biome_index, border_biome) in enumerate(biomes):
                for borders in combinations.keys():
                    column, rotations = combinations[borders]

                    y = tile_size * biome_index
                    result = tiles.crop((0, y, tile_size, y + tile_size))

                    x = tile_size * column
                    y = tile_size * other_biome_index
                    new_layer = tiles.crop((x, y, x + tile_size, y + tile_size))
                    new_layer = rotate(new_layer, rotations)

                    result.paste(new_layer, (0.0, 0.0), new_layer)

                    overall_x += 1
                    overall.paste(result, (overall_x * tile_size, overall_y * tile_size)) 

    overall.save(f"{destination_folder}/tiles_biome.png")        

def rotate(image, rotations):
    if isinstance(rotations, tuple):
        new_image = Image.new("RGBA", image.size, (0.0, 0.0, 0.0, 0.0))
        for rotation in rotations:
            rotated = image.rotate(rotation, expand=True)
            new_image = Image.alpha_composite(new_image, rotated)
        return new_image
    else:
        return image.rotate(rotations, expand=True)

os.system(f"rm -rf {pngs_folder}/tiles_biome.png")
export_biome_tiles(aseprite_assets, pngs_folder)