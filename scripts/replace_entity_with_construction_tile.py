import os
import json

"""
top_left     grass 44401
top_right    grass 44402
bottom_right grass 44403
bottom_left  grass 44404
side_bottom  grass 44405
side_top     grass 44406
side_left    grass 44407
side_right   grass 44408

        ('U', Construction::SlopeGreen1),
        ('V', Construction::SlopeRock1),
        ('W', Construction::SlopeSand1),
        ('X', Construction::SlopeDark1),
        ('Y', Construction::SlopeGreen2),
        ('Z', Construction::SlopeRock2),
        ('a', Construction::SlopeSand2),
        ('b', Construction::SlopeDark3),
"""

replacement_map = {
    # grass 
    44405: "U", # bottom
    44408: "U", # right
    44404: "U", # bottom left
    44406: "Y", # top
    44407: "Y", # left
    44401: "Y", # top left
    44402: "U",
    44403: "Y",

    # rock
    44415: "V", # bottom
    44418: "V", # right
    44414: "V", # bottom left
    44416: "Z", # top
    44417: "Z", # left
    44411: "Z", # top left
    44412: "V",
    44413: "Z",

    # sand
    44425: "W", # bottom
    44428: "W", # right
    44424: "W", # bottom left
    44426: "a", # top
    44427: "a", # left
    44421: "a", # top left
    44422: "W",
    44423: "a",

    # dark rock
    44435: "X", # bottom
    44438: "X", # right
    44434: "X", # bottom left
    44436: "b", # top
    44437: "b", # left
    44431: "b", # top left
    44432: "X",
    44433: "b",
}

species_to_replace = replacement_map.keys()

for filename in os.listdir("data"):
    if not filename.startswith("1"): continue
    if not filename.endswith("json"): continue

    f = open(f"data/{filename}")
    data = json.loads(f.read())
    f.close()
    
    entities_to_keep = [e for e in data["entities"] if e["species_id"] not in species_to_replace]
    entities_to_remove = [e for e in data["entities"] if e["species_id"] in species_to_replace]
    data["entities"] = entities_to_keep

    for entity in entities_to_remove:
        x = entity["frame"]["x"]
        y = entity["frame"]["y"]
        species = entity["species_id"]
        row = data["constructions_tiles"]["tiles"][y]
        row = list(row)
        print(row, x)
        row[x] = replacement_map[species]
        data["constructions_tiles"]["tiles"][y] = "".join(row)

    f = open(f"data/{filename}", "w")
    f.write(json.dumps(data, sort_keys=True, indent=2))
    f.close()