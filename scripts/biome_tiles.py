from enum import Enum, auto
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
import json
from tiles import IntRect, Direction

class Biome(Enum):
    NOTHING = '0'
    GRASS = '1'
    GRASS_FLOWERS_RED = 'C'
    GRASS_FLOWERS_YELLOW = 'D'
    GRASS_FLOWERS_BLUE = 'E'
    GRASS_FLOWERS_PURPLE = 'F'
    WATER = '2'
    ROCK = '3'
    DESERT = '4'
    SNOW = '5'
    DARK_WOOD = '6'
    LIGHT_WOOD = '7'
    DARK_ROCK = '8'
    ICE = '9'
    DARK_GRASS = 'A'
    ROCK_PLATES = 'B'
    LAVA = 'G'
    FARMLAND = 'H'
    DARK_WATER = 'J'

    @staticmethod
    def number_of_combinations() -> int:
        return 15

    @staticmethod
    def number_of_biomes() -> int:
        return 19

    def texture_index(self) -> int:
        texture_indices = {
            Biome.WATER: 0,
            Biome.DESERT: 1,
            Biome.GRASS: 2,
            Biome.GRASS_FLOWERS_RED: 12,
            Biome.GRASS_FLOWERS_YELLOW: 13,
            Biome.GRASS_FLOWERS_BLUE: 14,
            Biome.GRASS_FLOWERS_PURPLE: 15,
            Biome.ROCK: 3,
            Biome.SNOW: 4,
            Biome.LIGHT_WOOD: 5,
            Biome.DARK_WOOD: 6,
            Biome.NOTHING: 7,
            Biome.DARK_ROCK: 8,
            Biome.ICE: 9,
            Biome.DARK_GRASS: 10,
            Biome.ROCK_PLATES: 11,
            Biome.LAVA: 16,
            Biome.FARMLAND: 17,
            Biome.DARK_WATER: 18,
        }
        return texture_indices.get(self, 0)

    def is_same(self, other: 'Biome') -> bool:
        return self == other or (self.is_grass() and other.is_grass())

    def is_grass(self) -> bool:
        grass_biomes = {
            Biome.GRASS,
            Biome.GRASS_FLOWERS_RED,
            Biome.GRASS_FLOWERS_BLUE,
            Biome.GRASS_FLOWERS_YELLOW,
            Biome.GRASS_FLOWERS_PURPLE,
        }
        return self in grass_biomes

    @staticmethod
    def from_char(c: str) -> 'Biome':
        mapping = {
            '0': Biome.NOTHING,
            '1': Biome.GRASS,
            'C': Biome.GRASS_FLOWERS_RED,
            'D': Biome.GRASS_FLOWERS_YELLOW,
            'E': Biome.GRASS_FLOWERS_BLUE,
            'F': Biome.GRASS_FLOWERS_PURPLE,
            '2': Biome.WATER,
            '3': Biome.ROCK,
            '4': Biome.DESERT,
            '5': Biome.SNOW,
            '6': Biome.DARK_WOOD,
            '7': Biome.LIGHT_WOOD,
            '8': Biome.DARK_ROCK,
            '9': Biome.ICE,
            'A': Biome.DARK_GRASS,
            'B': Biome.ROCK_PLATES,
            'G': Biome.LAVA,
            'H': Biome.FARMLAND,
            'J': Biome.DARK_WATER,
        }
        return mapping.get(c.upper(), Biome.NOTHING)

    def to_char(self) -> str:
        reverse_mapping = {v: k for k, v in {
            '0': Biome.NOTHING,
            '1': Biome.GRASS,
            'C': Biome.GRASS_FLOWERS_RED,
            'D': Biome.GRASS_FLOWERS_YELLOW,
            'E': Biome.GRASS_FLOWERS_BLUE,
            'F': Biome.GRASS_FLOWERS_PURPLE,
            '2': Biome.WATER,
            '3': Biome.ROCK,
            '4': Biome.DESERT,
            '5': Biome.SNOW,
            '6': Biome.DARK_WOOD,
            '7': Biome.LIGHT_WOOD,
            '8': Biome.DARK_ROCK,
            '9': Biome.ICE,
            'A': Biome.DARK_GRASS,
            'B': Biome.ROCK_PLATES,
            'G': Biome.LAVA,
            'H': Biome.FARMLAND,
            'J': Biome.DARK_WATER,
        }.items()}
        return reverse_mapping.get(self, '0')


@dataclass
class BiomeTile:
    tile_type: Biome = Biome.GRASS
    tile_up_type: Biome = Biome.NOTHING
    tile_right_type: Biome = Biome.NOTHING
    tile_down_type: Biome = Biome.NOTHING
    tile_left_type: Biome = Biome.NOTHING
    texture_offset_x: int = 0
    texture_offset_y: int = 0

    def texture_source_rect(self, variant: int) -> IntRect:
        return IntRect.new(
            self.texture_offset_x,
            self.texture_offset_y + variant * Biome.number_of_biomes(),
            1,
            1
        )

    def is_obstacle(self) -> bool:
        return self.tile_type in {Biome.WATER, Biome.NOTHING, Biome.LAVA}

    def setup_neighbors(self, up: Biome, right: Biome, bottom: Biome, left: Biome):
        self.tile_up_type = up
        self.tile_right_type = right
        self.tile_down_type = bottom
        self.tile_left_type = left
        self.setup_textures()

    def setup_textures(self):
        self.texture_offset_x = self.texture_index_for_neighbors()
        self.texture_offset_y = self.tile_type.texture_index()

    def texture_index_for_neighbors(self) -> int:
        best_neighbor = self.best_neighbor()
        if best_neighbor:
            neighbor, directions = best_neighbor
            default_index = neighbor.texture_index() * Biome.number_of_combinations() + self.texture_index_for_directions(directions) + 1

            if self.tile_type.is_grass():
                if neighbor in {Biome.DESERT, Biome.ROCK, Biome.DARK_ROCK, Biome.SNOW, Biome.DARK_GRASS}:
                    return 0
                else:
                    return default_index

            match (self.tile_type, neighbor):
                case (Biome.WATER, Biome.DESERT) | (Biome.WATER, Biome.GRASS) | (Biome.WATER, Biome.DARK_GRASS) | \
                (Biome.LAVA, Biome.DESERT) | (Biome.LAVA, Biome.GRASS) | (Biome.LAVA, Biome.DARK_GRASS) | \
                (Biome.GRASS, Biome.DESERT) | (Biome.GRASS, Biome.ROCK) | (Biome.GRASS, Biome.DARK_ROCK) | \
                (Biome.GRASS, Biome.SNOW) | (Biome.DARK_GRASS, Biome.DESERT) | (Biome.DARK_GRASS, Biome.ROCK) | \
                (Biome.DARK_GRASS, Biome.DARK_ROCK) | (Biome.DARK_GRASS, Biome.SNOW) | (Biome.GRASS, Biome.DARK_GRASS) | \
                (Biome.SNOW, Biome.ROCK) | (Biome.WATER, Biome.DARK_ROCK) | (Biome.LAVA, Biome.DARK_ROCK) | \
                (Biome.DESERT, Biome.SNOW) | (Biome.ROCK, Biome.SNOW) | (Biome.DARK_ROCK, Biome.SNOW) | \
                (Biome.DARK_ROCK, Biome.DESERT) | (_, Biome.NOTHING):
                    return 0
                case _:
                    return default_index

        return 0

    def texture_index_for_directions(self, directions: List[Direction]) -> int:
        if len(directions) == 1:
            direction = directions[0]
            mapping = {
                Direction.UP: 0,
                Direction.RIGHT: 1,
                Direction.DOWN: 2,
                Direction.LEFT: 3
            }
            return mapping.get(direction, 0)
        if len(directions) == 2:
            pair = (directions[0], directions[1])
            mapping = {
                (Direction.UP, Direction.LEFT): 4,
                (Direction.UP, Direction.RIGHT): 5,
                (Direction.RIGHT, Direction.DOWN): 6,
                (Direction.DOWN, Direction.LEFT): 7,
                (Direction.UP, Direction.DOWN): 13,
                (Direction.RIGHT, Direction.LEFT): 14,
            }
            return mapping.get(pair, 0)
        if len(directions) == 3:
            trio = (directions[0], directions[1], directions[2])
            mapping = {
                (Direction.UP, Direction.RIGHT, Direction.DOWN): 8,
                (Direction.RIGHT, Direction.DOWN, Direction.LEFT): 9,
                (Direction.UP, Direction.DOWN, Direction.LEFT): 10,
                (Direction.UP, Direction.RIGHT, Direction.LEFT): 11,
            }
            return mapping.get(trio, 0)
        if len(directions) == 4:
            return 12
        return 0

    def best_neighbor(self) -> Optional[Tuple[Biome, List[Direction]]]:
        up_contacts = self.contact_directions_with_biome(self.tile_up_type)
        right_contacts = self.contact_directions_with_biome(self.tile_right_type)
        down_contacts = self.contact_directions_with_biome(self.tile_down_type)
        left_contacts = self.contact_directions_with_biome(self.tile_left_type)

        contacts = [
            (self.tile_up_type, up_contacts),
            (self.tile_right_type, right_contacts),
            (self.tile_down_type, down_contacts),
            (self.tile_left_type, left_contacts),
        ]

        # Iterate to find the best neighbor based on the number of contacts
        for i in range(1, 4):
            for neighbor, directions in contacts:
                if neighbor.is_same(self.tile_type):
                    continue
                if len(directions) >= 3 - i:
                    return (neighbor, directions)
        return None

    def contact_directions_with_biome(self, biome: Biome) -> List[Direction]:
        contacts = []
        if self.tile_up_type == biome:
            contacts.append(Direction.UP)
        if self.tile_right_type == biome:
            contacts.append(Direction.RIGHT)
        if self.tile_down_type == biome:
            contacts.append(Direction.DOWN)
        if self.tile_left_type == biome:
            contacts.append(Direction.LEFT)
        return contacts

    @staticmethod
    def from_data(data: str) -> 'BiomeTile':
        tile = BiomeTile(
            tile_type=Biome.from_char(data),
            tile_up_type=Biome.NOTHING,
            tile_right_type=Biome.NOTHING,
            tile_down_type=Biome.NOTHING,
            tile_left_type=Biome.NOTHING,
            texture_offset_x=0,
            texture_offset_y=0
        )
        tile.setup_textures()
        return tile

    @staticmethod
    def from_char(c: str) -> 'BiomeTile':
        return BiomeTile(Biome.from_char(c))

