import os
import sys

path = sys.path[0]

os.system(f"rm -rf {path}/../ios/Resources/assets")
os.system(f"rm -rf {path}/../ios/Resources/data")
os.system(f"rm -rf {path}/../ios/Resources/lang")
os.system(f"cp -r {path}/../assets {path}/../ios/Resources/assets")
os.system(f"cp -r {path}/../data {path}/../ios/Resources/data")
os.system(f"cp -r {path}/../lang {path}/../ios/Resources/lang")
os.system(f"rm -rf {path}/../ios/Resources/data/save.json")

os.system(f"rm -rf {path}/../android/app/src/main/assets/assets")
os.system(f"rm -rf {path}/../android/app/src/main/assets/data")
os.system(f"rm -rf {path}/../android/app/src/main/assets/lang")
os.system(f"cp -r {path}/../assets {path}/../android/app/src/main/assets/assets")
os.system(f"cp -r {path}/../data {path}/../android/app/src/main/assets/data")
os.system(f"cp -r {path}/../lang {path}/../android/app/src/main/assets/lang")
os.system(f"rm -rf {path}/../android/app/src/main/assets/data/save.json")
