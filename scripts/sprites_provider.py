from PIL import Image
import os
from typing import Dict, Tuple, Optional
from dataclasses import dataclass
from tiles import IntRect, TILE_SIZE

@dataclass
class RenderableItem:
    sprite_sheet_id: int  # Using int instead of UInt
    texture_rect: IntRect

class SpritesProvider:
    def __init__(self, assets_dir: str, sprite_sheet_file_names: Dict[int, str]):
        """
        :param assets_dir: Directory where asset images are stored.
        :param sprite_sheet_file_names: Mapping from spriteSheetID to file name (without extension).
        """
        self.assets_dir = assets_dir
        self.sprite_sheet_file_names = sprite_sheet_file_names
        self.cache: Dict[Tuple[int, IntRect], Image.Image] = {}
        self.sprite_sheet_images: Dict[int, Image.Image] = {}

    def bitmap_for(self, sprite_sheet_id: int, texture_rect: IntRect) -> Optional[Image.Image]:
        cache_key = (sprite_sheet_id, texture_rect)

        if cache_key in self.cache:
            return self.cache[cache_key]

        sheet_image = self.load_sprite_sheet_image(sprite_sheet_id)
        if sheet_image is None:
            return None

        left = texture_rect.x * TILE_SIZE
        upper = texture_rect.y * TILE_SIZE
        right = (texture_rect.x + texture_rect.w) * TILE_SIZE
        lower = (texture_rect.y + texture_rect.h) * TILE_SIZE

        # Crop the image
        cropped_bitmap = sheet_image.crop((left, upper, right, lower))
        self.cache[cache_key] = cropped_bitmap
        return cropped_bitmap

    def load_sprite_sheet_image(self, sprite_sheet_id: int) -> Optional[Image.Image]:
        if sprite_sheet_id in self.sprite_sheet_images:
            return self.sprite_sheet_images[sprite_sheet_id]

        file_name = self.sprite_sheet_file_names.get(sprite_sheet_id)
        if not file_name:
            return None

        file_path = os.path.join(self.assets_dir, f"{file_name}.png")
        if not os.path.exists(file_path):
            print(f"Sprite sheet file not found: {file_path}")
            return None

        try:
            image = Image.open(file_path).convert("RGBA")
            self.sprite_sheet_images[sprite_sheet_id] = image
            return image
        except IOError as e:
            print(f"Error loading sprite sheet {file_path}: {e}")
            return None

    def bitmap_for_entity(self, entity: RenderableItem) -> Optional[Image.Image]:
        return self.bitmap_for(entity.sprite_sheet_id, entity.texture_rect)
