import os
import sys

path = sys.path[0]

os.system(f"cp -r {path}/../assets/* {path}/../ios/Resources/assets")
os.system(f"cp -r {path}/../data/* {path}/../ios/Resources/data")
os.system(f"rm -rf {path}/../ios/Resources/data/inventory.json")
os.system(f"rm -rf {path}/../ios/Resources/data/save.json")
os.system(f"cp -r {path}/../lang/* {path}/../ios/Resources/lang")
