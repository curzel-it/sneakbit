import re
import os
import pdb
import json
import sys
from biome_tiles import Biome, BiomeTile
from construction_tiles import Construction, ConstructionTile
from tiles import Direction, IntRect, TILE_SIZE
from sprites_provider import SpritesProvider, RenderableItem

from typing import List, Optional
from PIL import Image
from biome_tiles import BiomeTile
from construction_tiles import ConstructionTile
from tiles import IntRect
from sprites_provider import SpritesProvider

class TileMapImageGenerator:
    def __init__(self, sprites_provider: SpritesProvider):
        """
        Initializes the TileMapImageGenerator with a given SpritesProvider.

        :param sprites_provider: An instance of SpritesProvider to fetch sprite bitmaps.
        """
        self.sprites_provider = sprites_provider

    def generate(
        self,
        world_width: int,
        world_height: int,
        variant: int,
        biome_tiles: List[List[BiomeTile]],
        construction_tiles: List[List[ConstructionTile]]
    ) -> Optional[Image.Image]:
        """
        Generates a composite tile map image based on biome and construction tiles.

        :param world_width: The width of the world in tiles.
        :param world_height: The height of the world in tiles.
        :param variant: Variant index for biome tile selection.
        :param biome_tiles: 2D list of BiomeTile objects representing the biome layer.
        :param construction_tiles: 2D list of ConstructionTile objects representing the construction layer.
        :return: A PIL Image object of the composed tile map or None if input is invalid.
        """
        # Validate input
        if not biome_tiles or not construction_tiles:
            print("Biome tiles or construction tiles are empty.")
            return None
        if world_width == 0 or world_height == 0:
            print("World width or height is zero.")
            return None

        # Retrieve tile size from NativeLib
        tile_size = TILE_SIZE  # e.g., 32 pixels
        map_width = world_width * tile_size
        map_height = world_height * tile_size

        # Create a blank image with RGBA mode
        composed_image = Image.new("RGBA", (map_width, map_height))

        # Render Biome Tiles
        for row in range(world_height):
            for col in range(world_width):
                biome_tile = biome_tiles[row][col]
                if biome_tile.tile_type == 0:
                    continue  # Skip empty tiles

                biome_tile.setup_neighbors(
                    biome_tiles[row-1][col].tile_type if row > 0 else Biome.NOTHING,
                    biome_tiles[row][col+1].tile_type if col < 119 else Biome.NOTHING,
                    biome_tiles[row+1][col].tile_type if row < 79 else Biome.NOTHING,
                    biome_tiles[row][col-1].tile_type if col > 0 else Biome.NOTHING,
                )

                # Define the texture rectangle for the biome tile
                texture_rect = IntRect(
                    x=biome_tile.texture_offset_x,
                    y=biome_tile.texture_offset_y, # + variant * Biome.number_of_biomes(),
                    w=1,
                    h=1
                )

                # Fetch the bitmap for the biome tile
                bitmap = self.sprites_provider.bitmap_for(1002, texture_rect)
                if bitmap:
                    # Calculate the position to paste the tile
                    position = (col * tile_size, row * tile_size)
                    self.render_tile_image(bitmap, position, composed_image)

        # Render Construction Tiles
        for row in range(world_height):
            for col in range(world_width):
                construction_tile = construction_tiles[row][col]
                if construction_tile.tile_type == 0:
                    continue  # Skip empty tiles

                construction_tile.setup_neighbors(
                    construction_tiles[row-1][col].tile_type if row > 0 else Construction.Nothing,
                    construction_tiles[row][col+1].tile_type if col < 119 else Construction.Nothing,
                    construction_tiles[row+1][col].tile_type if row < 79 else Construction.Nothing,
                    construction_tiles[row][col-1].tile_type if col > 0 else Construction.Nothing,
                )

                source_rect = construction_tile.texture_source_rect
                if source_rect.x != 0:
                    # Define the texture rectangle for the construction tile
                    texture_rect = IntRect(
                        x=source_rect.x,
                        y=source_rect.y,
                        w=source_rect.w,
                        h=source_rect.h
                    )

                    # Fetch the bitmap for the construction tile
                    bitmap = self.sprites_provider.bitmap_for(1003, texture_rect)
                    if bitmap:
                        # Calculate the position to paste the tile
                        position = (col * tile_size, row * tile_size)
                        self.render_tile_image(bitmap, position, composed_image)

        return composed_image

    def render_tile_image(self, bitmap: Image.Image, position: tuple, composed_image: Image.Image):
        """
        Pastes a single tile bitmap onto the composed image at the specified position.

        :param bitmap: The PIL Image bitmap of the tile to paste.
        :param position: A tuple (x, y) representing the top-left corner where the tile will be pasted.
        :param composed_image: The PIL Image object representing the composed map.
        """
        # Ensure the bitmap is in RGBA mode to support transparency
        if bitmap.mode != "RGBA":
            bitmap = bitmap.convert("RGBA")
        
        # Paste the bitmap onto the composed image using itself as a mask for transparency
        composed_image.paste(bitmap, position, bitmap)

def parse_tile_map_json(json_file_path: str):
    """
    Parses the tile map JSON file and constructs biome and construction tile lists.

    :param json_file_path: Path to the JSON file.
    :return: A tuple containing:
             - biome_tiles: 2D list of BiomeTile objects
             - construction_tiles: 2D list of ConstructionTile objects
             - biome_sheet_id: Sprite sheet ID for biome tiles
             - construction_sheet_id: Sprite sheet ID for construction tiles
    """
    with open(json_file_path, 'r') as file:
        data = json.load(file)

    # Extract sheet IDs
    biome_sheet_id = data['biome_tiles']['sheet_id']
    construction_sheet_id = data['constructions_tiles']['sheet_id']

    # Parse Biome Tiles
    biome_tiles_rows = data['biome_tiles']['tiles']
    biome_tiles: List[List[BiomeTile]] = []
    for row_str in biome_tiles_rows:
        row_tiles = [BiomeTile.from_char(char) for char in row_str]
        biome_tiles.append(row_tiles)

    # Parse Construction Tiles
    construction_tiles_rows = data['constructions_tiles']['tiles']
    construction_tiles: List[List[ConstructionTile]] = []
    for row_str in construction_tiles_rows:
        row_tiles = [ConstructionTile.from_char(char) for char in row_str]
        construction_tiles.append(row_tiles)

    # Validate that both tile layers have the same dimensions
    world_height = len(biome_tiles)
    world_width = len(biome_tiles[0]) if world_height > 0 else 0

    if len(construction_tiles) != world_height:
        raise ValueError("Biome tiles and Construction tiles have different number of rows.")
    for row in construction_tiles:
        if len(row) != world_width:
            raise ValueError("Biome tiles and Construction tiles have different number of columns.")

    return biome_tiles, construction_tiles, biome_sheet_id, construction_sheet_id, world_width, world_height

def main(json_file_path: str, output_image_path: str, variant: int):
    """
    Main function to generate tile map image from JSON.

    :param json_file_path: Path to the input JSON file.
    :param output_image_path: Path to save the generated image.
    :param variant: Variant index for biome tile selection.
    """
    # Parse the JSON file
    try:
        biome_tiles, construction_tiles, biome_sheet_id, construction_sheet_id, world_width, world_height = parse_tile_map_json(json_file_path)
        print(f"Parsed JSON successfully: World Size = {world_width}x{world_height}")        
    except Exception as e:
        print(f"Error parsing JSON file: {e}")
        sys.exit(1)

    # Initialize SpritesProvider
    sprites_provider = SpritesProvider("assets", {1002: "tiles_biome", 1003: "tiles_constructions"})

    # Initialize TileMapImageGenerator
    tile_map_generator = TileMapImageGenerator(sprites_provider)

    # Generate the tile map image
    tile_map_image = tile_map_generator.generate(
        world_width=world_width,
        world_height=world_height,
        variant=variant,
        biome_tiles=biome_tiles,
        construction_tiles=construction_tiles
    )

    if tile_map_image:
        # Save the image to the specified path
        tile_map_image.save(output_image_path)
        print(f"Tile map image saved to {output_image_path}")
    else:
        print("Failed to generate tile map image.")

if __name__ == "__main__":
    for filename in os.listdir("data"):
        if not bool(re.match(r"^\d+\.json$", filename)): continue
        world_id = filename.split(".")[0]

        for variant in range(0, 4):
            main(f"data/{filename}", f"assets/{world_id}-{variant}.png", variant)