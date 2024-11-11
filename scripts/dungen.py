import json
import random
import argparse

"""
Dungeon 
python3 scripts/dungen.py worldid --pavement B --wall H --padding 0 --min_room_size 5  --max_room_size 12 --width 120 --height 80

Dark Cave
python3 scripts/dungen.py worldid --pavement 8 --wall 3 --padding 0 --min_room_size 5  --max_room_size 12 --width 120 --height 80

Water Cave
python3 scripts/dungen.py worldid --pavement 8 --wall 0 --padding 0 --empty 2 --min_room_size 5  --max_room_size 12 --width 120 --height 80

Forest
python3 scripts/dungen.py 1017 --pavement 1 --wall 8 --fill  --width 40 --height 30 --padding 20

Forest Village
python3 scripts/dungen.py worldid --pavement 1 --wall 8 --fill --min_room_size 1  --max_room_size 2 --width 60 --height 40

Dark Forest
python3 scripts/dungen.py worldid --pavement A --wall 8 --padding 10 --empty A --min_room_size 3 --max_room_size 8 --width 60 --height 60 

Island
python3 scripts/dungen.py worldid --pavement 1 --empty 2 --wall 0 --padding_pavement 2 --padding_wall 0 --min_room_size 8  --max_room_size 20 --width 120 --height 80

Arcipelago
python3 scripts/dungen.py worldid --pavement 4 --empty 2 --wall 0 --padding_pavement 2 --padding_wall 0 --min_room_size 3 --max_room_size 8 --width 60 --height 80

Sandy Valley
python3 scripts/dungen.py worldid --pavement 4 --wall 0 --padding 10 --min_room_size 5  --max_room_size 12 --width 100 --height 50
"""

# Parse command-line arguments
parser = argparse.ArgumentParser(description='Generate a dungeon map with customizable parameters and a specific world ID.')
parser.add_argument('world_id', type=int, help='The ID of the world to be generated.')

# Parameters to make configurable
parser.add_argument('--width', type=int, default=80, help='Width of the dungeon map (default: 120)')
parser.add_argument('--height', type=int, default=60, help='Height of the dungeon map (default: 80)')
parser.add_argument('--min_room_size', type=int, default=6, help='Minimum size of a room (default: 6)')
parser.add_argument('--max_room_size', type=int, default=15, help='Maximum size of a room (default: 15)')
parser.add_argument('--pavement', type=str, default='B', help='Character representing pavement inside rooms and corridors (default: B)')
parser.add_argument('--wall', type=str, default='H', help='Character representing walls (default: H)')
parser.add_argument('--empty', type=str, default='0', help='Character representing empty space in biome tiles (default: 0)')
parser.add_argument('--no_wall', type=str, default='0', help='Character representing no wall in construction tiles (default: 0)')
parser.add_argument('--padding', type=int, default=20, help='Number of tiles to use as padding (added to the final size) around world edges')
parser.add_argument('--fill', action='store_true', help='Fill DOUNGEON_EMPTY biome tiles with DOUNGEON_WALL in construction tiles.')
parser.add_argument('--fill_pavement', action='store_true', help='Fill DOUNGEON_EMPTY biome tiles with DOUNGEON_WALL in construction tiles.')
parser.add_argument('--padding_pavement', type=str, default='', help='Cell type to use in padding')
parser.add_argument('--padding_wall', type=str, default='', help='Cell type to use in padding')

args = parser.parse_args()

# Assign variables from parsed arguments
WIDTH = args.width
HEIGHT = args.height
MIN_ROOM_SIZE = args.min_room_size
MAX_ROOM_SIZE = args.max_room_size
DOUNGEON_PAVEMENT = args.pavement
DOUNGEON_WALL = args.wall
DOUNGEON_EMPTY = args.empty
DOUNGEON_NO_WALL = args.no_wall
PADDING_PAVEMENT = args.padding_pavement if args.padding_pavement != '' else DOUNGEON_PAVEMENT
PADDING_WALL = args.padding_wall if args.padding_wall != '' else DOUNGEON_WALL

# Initialize the dungeon map with walls
dungeon_map = [
    [DOUNGEON_WALL for _ in range(WIDTH)]
    for _ in range(HEIGHT)
]

class Room:
    def __init__(self, x, y, width, height):
        self.x = x          # Top-left corner x
        self.y = y          # Top-left corner y
        self.width = width
        self.height = height
        self.center = (x + width // 2, y + height // 2)
        
    def intersects(self, other):
        return (
            self.x <= other.x + other.width and
            self.x + self.width >= other.x and
            self.y <= other.y + other.height and
            self.y + self.height >= other.y
        )

def create_room(room):
    for y in range(room.y, room.y + room.height):
        for x in range(room.x, room.x + room.width):
            dungeon_map[y][x] = DOUNGEON_PAVEMENT

def create_h_tunnel(x1, x2, y):
    for x in range(min(x1, x2), max(x1, x2) + 1):
        dungeon_map[y][x] = DOUNGEON_PAVEMENT

def create_v_tunnel(y1, y2, x):
    for y in range(min(y1, y2), max(y1, y2) + 1):
        dungeon_map[y][x] = DOUNGEON_PAVEMENT

def split_space(x, y, width, height, rooms):
    # Base case: Stop splitting if the area is too small
    if width < MAX_ROOM_SIZE * 2 and height < MAX_ROOM_SIZE * 2:
        room_width = random.randint(MIN_ROOM_SIZE, min(width, MAX_ROOM_SIZE))
        room_height = random.randint(MIN_ROOM_SIZE, min(height, MAX_ROOM_SIZE))
        room_x = x + random.randint(0, width - room_width)
        room_y = y + random.randint(0, height - room_height)
        new_room = Room(room_x, room_y, room_width, room_height)
        create_room(new_room)
        rooms.append(new_room)
        return
    
    # Decide whether to split horizontally or vertically
    if width / height >= 1.25:
        split_horizontally = False
    elif height / width >= 1.25:
        split_horizontally = True
    else:
        split_horizontally = random.choice([True, False])
    
    if split_horizontally:
        split = random.randint(int(height * 0.3), int(height * 0.7))
        split_space(x, y, width, split, rooms)
        split_space(x, y + split, width, height - split, rooms)
    else:
        split = random.randint(int(width * 0.3), int(width * 0.7))
        split_space(x, y, split, height, rooms)
        split_space(x + split, y, width - split, height, rooms)

def connect_rooms(rooms):
    for i in range(1, len(rooms)):
        prev_center = rooms[i - 1].center
        curr_center = rooms[i].center

        if random.choice([True, False]):
            create_h_tunnel(prev_center[0], curr_center[0], prev_center[1])
            create_v_tunnel(prev_center[1], curr_center[1], curr_center[0])
        else:
            create_v_tunnel(prev_center[1], curr_center[1], prev_center[0])
            create_h_tunnel(prev_center[0], curr_center[0], curr_center[1])

def cleanup_walls():
    new_dungeon_map = [
        [DOUNGEON_EMPTY for _ in range(WIDTH)]
        for _ in range(HEIGHT)
    ]
    
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if dungeon_map[y][x] == DOUNGEON_PAVEMENT:
                # Keep floor tiles
                new_dungeon_map[y][x] = DOUNGEON_PAVEMENT
            else:
                # If any adjacent tile (including diagonals) is a floor, keep wall
                adjacent_to_floor = False
                for dy in [-1, 0, 1]:
                    for dx in [-1, 0, 1]:
                        if dy == 0 and dx == 0:
                            continue  # Skip the current tile
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < HEIGHT and 0 <= nx < WIDTH:
                            if dungeon_map[ny][nx] == DOUNGEON_PAVEMENT:
                                adjacent_to_floor = True
                                break
                    if adjacent_to_floor:
                        break
                if adjacent_to_floor:
                    new_dungeon_map[y][x] = DOUNGEON_WALL
                else:
                    # Remove extra wall (set to empty)
                    new_dungeon_map[y][x] = DOUNGEON_EMPTY
    return new_dungeon_map

# Generate rooms and corridors using BSP
rooms = []
split_space(1, 1, WIDTH - 2, HEIGHT - 2, rooms)
connect_rooms(rooms)

# Clean up walls to ensure they are exactly one tile thick and include corners
dungeon_map = cleanup_walls()

# Generate biome tiles based on the dungeon map
biome_tiles = [
    [DOUNGEON_PAVEMENT if dungeon_map[y][x] == DOUNGEON_PAVEMENT else DOUNGEON_EMPTY for x in range(WIDTH)]
    for y in range(HEIGHT)
]

# Generate construction tiles based on the dungeon map
construction_tiles = [
    [DOUNGEON_WALL if dungeon_map[y][x] == DOUNGEON_WALL else DOUNGEON_NO_WALL for x in range(WIDTH)]
    for y in range(HEIGHT)
]

# Post-processing: If fill flag is present, update construction tiles
if args.fill:
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if biome_tiles[y][x] == DOUNGEON_EMPTY:
                construction_tiles[y][x] = DOUNGEON_WALL
                biome_tiles[y][x] = DOUNGEON_WALL
elif args.fill_pavement:
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if biome_tiles[y][x] == DOUNGEON_EMPTY:
                biome_tiles[y][x] = DOUNGEON_WALL

# Convert tile grids to strings
biome_tile_strings = [''.join(row) for row in biome_tiles]
construction_tile_strings = [''.join(row) for row in construction_tiles]

# Post-processing: Add padding tiles
padding_horizontal_biomes = args.padding * PADDING_PAVEMENT
padding_horizontal_constructions = args.padding * PADDING_WALL

for i in range(0, len(biome_tile_strings)):
    biome_tile_strings[i] = padding_horizontal_biomes + biome_tile_strings[i] + padding_horizontal_biomes
    construction_tile_strings[i] = padding_horizontal_constructions + construction_tile_strings[i] + padding_horizontal_constructions

padding_vertical_biomes = [len(biome_tile_strings[0]) * PADDING_PAVEMENT] * args.padding
biome_tile_strings = padding_vertical_biomes + biome_tile_strings + padding_vertical_biomes

padding_vertical_constructions = [len(construction_tile_strings[0]) * PADDING_WALL] * args.padding
construction_tile_strings = padding_vertical_constructions + construction_tile_strings + padding_vertical_constructions

# Assemble json
world_data = {
    "id": args.world_id,
    "biome_tiles": {
        "tiles": biome_tile_strings,
        "sheet_id": 1002
    },
    "constructions_tiles": {
        "tiles": construction_tile_strings,
        "sheet_id": 1003
    },
    "entities": [],
    "is_interior": True if args.padding == 0 else False,
    "ephemeral_state": True,
}

output_filename = f"/Users/curzel/dev/sneakbit/data/{args.world_id}.json"
with open(output_filename, "w") as f:
    f.write(json.dumps(world_data, indent=2))

print(f"Dungeon {args.world_id} has been generated and saved to {output_filename}")
if args.fill:
    print("Fill parameter was used: DOUNGEON_EMPTY biome tiles have been filled with DOUNGEON_WALL in construction tiles.")
