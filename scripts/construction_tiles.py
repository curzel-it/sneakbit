from enum import IntEnum
from dataclasses import dataclass, field
from typing import List
from tiles import IntRect
import json

class Construction(IntEnum):
    Nothing = 0
    WoodenFence = 1
    MetalFence = 16
    DarkRock = 3
    LightWall = 4
    Counter = 5
    Library = 6
    TallGrass = 7
    Forest = 8
    Bamboo = 9
    Box = 10
    Rail = 11
    StoneWall = 12
    IndicatorArrow = 13
    Bridge = 14
    Broadleaf = 15
    StoneBox = 17
    SpoiledTree = 18
    WineTree = 19

    @staticmethod
    def from_char(c: str):
        mapping = {
            '0': Construction.Nothing,
            '1': Construction.WoodenFence,
            '3': Construction.DarkRock,
            '4': Construction.LightWall,
            '5': Construction.Counter,
            '6': Construction.Library,
            '7': Construction.TallGrass,
            '8': Construction.Forest,
            '9': Construction.Bamboo,
            'A': Construction.Box,
            'B': Construction.Rail,
            'C': Construction.StoneWall,
            'D': Construction.IndicatorArrow,
            'E': Construction.Bridge,
            'F': Construction.Broadleaf,
            'G': Construction.MetalFence,
            'H': Construction.StoneBox,
            'J': Construction.SpoiledTree,
            'K': Construction.WineTree
        }
        return mapping.get(c.upper(), Construction.Nothing)

    def to_char(self) -> str:
        reverse_mapping = {
            Construction.Nothing: '0',
            Construction.WoodenFence: '1',
            Construction.DarkRock: '3',
            Construction.LightWall: '4',
            Construction.Counter: '5',
            Construction.Library: '6',
            Construction.TallGrass: '7',
            Construction.Forest: '8',
            Construction.Bamboo: '9',
            Construction.Box: 'A',
            Construction.Rail: 'B',
            Construction.StoneWall: 'C',
            Construction.IndicatorArrow: 'D',
            Construction.Bridge: 'E',
            Construction.Broadleaf: 'F',
            Construction.MetalFence: 'G',
            Construction.StoneBox: 'H',
            Construction.SpoiledTree: 'J',
            Construction.WineTree: 'K'
        }
        return reverse_mapping.get(self, '0')

    def texture_offset_x(self) -> int:
        mapping = {
            Construction.Nothing: 0,
            Construction.WoodenFence: 1,
            Construction.DarkRock: 3,
            Construction.LightWall: 4,
            Construction.Counter: 5,
            Construction.Library: 6,
            Construction.TallGrass: 7,
            Construction.Forest: 8,
            Construction.Bamboo: 9,
            Construction.Box: 10,
            Construction.Rail: 11,
            Construction.StoneWall: 12,
            Construction.IndicatorArrow: 13,
            Construction.Bridge: 14,
            Construction.Broadleaf: 15,
            Construction.MetalFence: 16,
            Construction.StoneBox: 17,
            Construction.SpoiledTree: 18,
            Construction.WineTree: 19
        }
        return mapping.get(self, 0)


@dataclass
class ConstructionTile:
    tile_type: Construction = Construction.Nothing
    tile_up_type: Construction = Construction.Nothing
    tile_right_type: Construction = Construction.Nothing
    tile_down_type: Construction = Construction.Nothing
    tile_left_type: Construction = Construction.Nothing
    texture_source_rect: IntRect = field(default_factory=lambda: IntRect.square_from_origin(1))

    def texture_source_rect_method(self, _: int) -> IntRect:
        return self.texture_source_rect

    def is_obstacle(self) -> bool:
        non_obstacles = {
            Construction.Nothing,
            Construction.TallGrass,
            Construction.Box,
            Construction.Rail,
            Construction.Bridge
        }
        return self.tile_type not in non_obstacles

    def setup_neighbors(self, up: Construction, right: Construction, bottom: Construction, left: Construction):
        self.tile_up_type = up
        self.tile_right_type = right
        self.tile_down_type = bottom
        self.tile_left_type = left
        self.setup_textures()

    def setup_textures(self):
        same_up = self.tile_up_type == self.tile_type
        same_right = self.tile_right_type == self.tile_type
        same_down = self.tile_down_type == self.tile_type
        same_left = self.tile_left_type == self.tile_type

        x = self.tile_type.texture_offset_x()

        # Mapping tuple to y value
        mapping = {
            (False, True, False, True): 0,
            (False, False, False, False): 1,
            (False, False, False, True): 2,
            (False, True, False, False): 3,
            (True, False, True, False): 4,
            (True, False, False, False): 5,
            (False, False, True, False): 6,
            (True, True, False, False): 7,
            (True, False, False, True): 8,
            (False, True, True, False): 9,
            (False, False, True, True): 10,
            (True, True, True, False): 11,
            (True, False, True, True): 12,
            (True, True, False, True): 13,
            (False, True, True, True): 14,
            (True, True, True, True): 15,
        }

        y = mapping.get((same_up, same_right, same_down, same_left), 1)  # Default to 1 if not found

        self.texture_source_rect.x = x
        self.texture_source_rect.y = y

    @classmethod
    def from_data(cls, data: str) -> 'ConstructionTile':
        tile = cls(
            tile_type=Construction.from_char(data),
            tile_up_type=Construction.Nothing,
            tile_right_type=Construction.Nothing,
            tile_down_type=Construction.Nothing,
            tile_left_type=Construction.Nothing,
            texture_source_rect=IntRect.square_from_origin(1)
        )
        tile.setup_textures()
        return tile

    def to_char(self) -> str:
        return self.tile_type.to_char()

    @staticmethod
    def from_char(c: str) -> 'ConstructionTile':
        return ConstructionTile(Construction.from_char(c))