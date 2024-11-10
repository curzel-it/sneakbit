import json
import random
import argparse
from noise import pnoise2

WIDTH = 120
HEIGHT = 80

freq = 0.8
octaves = 3
persistence = 0.1
lacunarity = 2.0

WATER = '2'
SAND = '4'
GRASSES = '1'.split(' ')
DOUNGEON_PAVEMENT = 'B'
DOUNGEON_WALL = 'H'

tiles = [[WATER for _ in range(WIDTH)] for _ in range(HEIGHT)]

def falloff(x, y):
    nx = x / WIDTH * 2 - 1
    ny = y / HEIGHT * 2 - 1
    distance = ((nx**2 + ny**2) ** 0.5) / (2 ** 0.5)
    return distance ** 2

for y in range(HEIGHT):
    for x in range(WIDTH):
        if x == 0 or y == 0 or x == WIDTH - 1 or y == HEIGHT - 1:
            continue

        nx = x / WIDTH - 0.5
        ny = y / HEIGHT - 0.5

        e = pnoise2(
            nx * freq,
            ny * freq,
            octaves=octaves,
            persistence=persistence,
            lacunarity=lacunarity,
            repeatx=WIDTH,
            repeaty=HEIGHT,
            base=random.randint(0, 1000)
        )

        e = e - falloff(x, y) + 0.6

        if e > 0.05:
            tiles[y][x] = SAND
        else:
            tiles[y][x] = WATER

def smooth_map(tiles):
    new_tiles = [row[:] for row in tiles]
    for y in range(1, HEIGHT - 1):
        for x in range(1, WIDTH - 1):
            counts = {WATER: 0, SAND: 0, 'grass': 0}
            for dy in [-1, 0, 1]:
                for dx in [-1, 0, 1]:
                    if dy == 0 and dx == 0:
                        continue
                    neighbor = tiles[y + dy][x + dx]
                    if neighbor in GRASSES: neighbor = 'grass'
                    counts[neighbor] += 1
            max_tile = max(counts, key=counts.get)
            new_tiles[y][x] = max_tile
    return new_tiles

for _ in range(3):
    tiles = smooth_map(tiles)

def remove_inland_water(tiles):
    visited = [[False for _ in range(WIDTH)] for _ in range(HEIGHT)]
    queue = []

    for x in range(WIDTH):
        if tiles[0][x] == WATER:
            queue.append((0, x))
            visited[0][x] = True
        if tiles[HEIGHT - 1][x] == WATER:
            queue.append((HEIGHT - 1, x))
            visited[HEIGHT - 1][x] = True

    for y in range(HEIGHT):
        if tiles[y][0] == WATER:
            queue.append((y, 0))
            visited[y][0] = True
        if tiles[y][WIDTH - 1] == WATER:
            queue.append((y, WIDTH - 1))
            visited[y][WIDTH - 1] = True

    while queue:
        y, x = queue.pop(0)
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = y + dy, x + dx
            if 0 <= ny < HEIGHT and 0 <= nx < WIDTH:
                if not visited[ny][nx] and tiles[ny][nx] == WATER:
                    visited[ny][nx] = True
                    queue.append((ny, nx))

    for y in range(HEIGHT):
        for x in range(WIDTH):
            if tiles[y][x] == WATER and not visited[y][x]:
                tiles[y][x] = SAND

    return tiles

tiles = remove_inland_water(tiles)

def get_tile(tiles, y, x):
    if 0 <= y < HEIGHT and 0 <= x < WIDTH:
        return tiles[y][x]
    else:
        return WATER

def add_grass(tiles):
    new_tiles = [row[:] for row in tiles]
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if get_tile(tiles, y, x) != WATER and \
                get_tile(tiles, y-1, x) != WATER and \
                get_tile(tiles, y-2, x) != WATER and \
                get_tile(tiles, y+1, x) != WATER and \
                get_tile(tiles, y+2, x) != WATER and \
                get_tile(tiles, y, x-1) != WATER and \
                get_tile(tiles, y, x-2) != WATER and \
                get_tile(tiles, y, x+1) != WATER and \
                get_tile(tiles, y, x+2) != WATER and \
                get_tile(tiles, y+1, x+1) != WATER and \
                get_tile(tiles, y-1, x+1) != WATER and \
                get_tile(tiles, y-1, x-1) != WATER and \
                get_tile(tiles, y+1, x-1) != WATER and \
                get_tile(tiles, y-2, x-1) != WATER and \
                get_tile(tiles, y+2, x-1) != WATER and \
                get_tile(tiles, y-1, x-2) != WATER and \
                get_tile(tiles, y-1, x+2) != WATER:
                    new_tiles[y][x] = random.choice(GRASSES)
    return new_tiles

tiles = add_grass(tiles)

tile_strings = [''.join(row) for row in tiles]

parser = argparse.ArgumentParser(description='Generate a biome map with a specific world ID.')
parser.add_argument('world_id', type=int, help='The ID of the world to be generated.')

args = parser.parse_args()

world_data = {
    "id": args.world_id,
    "biome_tiles": {
        "tiles": tile_strings,
        "sheet_id": 1002
    },
    "constructions_tiles": {
        "tiles": ["0" * WIDTH] * HEIGHT,
        "sheet_id": 1003
    },
    "entities": [],
    "default_biome": "Water"
}

output_filename = f"/Users/curzel/dev/sneakbit/data/{args.world_id}.json"
with open(output_filename, "w") as f:
    f.write(json.dumps(world_data, indent=2))

print(f"World {args.world_id} has been generated and saved to {output_filename}")
