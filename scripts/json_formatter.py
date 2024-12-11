import os
import json

for filename in os.listdir("data"):
    if not filename.endswith(".json"): continue
    path = f"data/{filename}"

    f = open(path, "r")
    contents = json.loads(f.read())
    f.close()

    f = open(path, "w")
    f.write(json.dumps(contents, indent=2, sort_keys=True))
    f.close()