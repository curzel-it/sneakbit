import json
import random
import argparse

WIDTH = 120
HEIGHT = 80
MIN_ROOM_SIZE = 6
MAX_ROOM_SIZE = 15

DOUNGEON_EMPTY = '0'    # Represents black spot outside the dungeon
DOUNGEON_PAVEMENT = 'B' # Represents pavement inside rooms and corridors
DOUNGEON_WALL = 'H'     # Represents walls
DOUNGEON_NO_WALL = '0'  # Represents pedestrian space (no wall)

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

# Convert tile grids to strings
biome_tile_strings = [''.join(row) for row in biome_tiles]
construction_tile_strings = [''.join(row) for row in construction_tiles]

# Parse command-line arguments
parser = argparse.ArgumentParser(description='Generate a dungeon map with a specific world ID.')
parser.add_argument('world_id', type=int, help='The ID of the world to be generated.')

args = parser.parse_args()

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
    "creep_spawn_enabled": False,
    "creep_spawn_interval": 0.0,
    "default_biome": "Nothing"
}

output_filename = f"/Users/curzel/dev/sneakbit/data/{args.world_id}.json"
with open(output_filename, "w") as f:
    f.write(json.dumps(world_data, indent=2))

print(f"Dungeon {args.world_id} has been generated and saved to {output_filename}")
