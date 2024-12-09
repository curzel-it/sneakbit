import os
import json

replacement_map = {
    44401: "U",
    44402: "V",
    44403: "W",
    44404: "X",
    44405: "Y",
    44406: "Z",
    44407: "a",
    44408: "b",
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