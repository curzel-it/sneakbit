import os
import json

for filename in os.listdir("data"):
    if not filename.endswith(".json"): continue
    path = f"data/{filename}"

    f = open(path, "r")
    contents = json.loads(f.read())
    f.close()

    updated = json.dumps(contents, indent=2, sort_keys=True)
    
    # Avoids invalidating map sprites
    if contents != updated:
        f = open(path, "w")
        f.write(updated)
        f.close()