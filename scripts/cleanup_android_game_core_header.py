import re

file_path = "android/app/src/main/cpp/game_core.h"

with open(file_path, "r") as f:
    contents = f.read()

pattern_biome = re.compile(
    r'enum\s+Biome\s*\{[^}]*\};', re.DOTALL
)
pattern_construction = re.compile(
    r'enum\s+Construction\s*\{[^}]*\};', re.DOTALL
)

contents = pattern_biome.sub('', contents)
contents = pattern_construction.sub('', contents)
contents = re.sub(r'\n\s*\n', '\n', contents)

with open(file_path, "w") as f:
    f.write(contents)

print("Enum definitions removed successfully.")
