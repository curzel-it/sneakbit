from enum import Enum
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

TILE_SIZE = 16

class Direction(Enum):
    UP = 'Up'
    RIGHT = 'Right'
    DOWN = 'Down'
    LEFT = 'Left'

class IntRect:
    def __init__(self, x: int, y: int, w: int, h: int):
        self.x = x
        self.y = y
        self.w = w
        self.h = h

    @classmethod
    def square_from_origin(cls, size: int):
        return cls(x=0, y=0, w=size, h=size)

    def to_dict(self):
        return {
            "x": self.x,
            "y": self.y,
            "w": self.w,
            "h": self.h
        }

    @classmethod
    def from_dict(cls, data):
        return cls(
            x=data["x"],
            y=data["y"],
            w=data["w"],
            h=data["h"]
        )
    