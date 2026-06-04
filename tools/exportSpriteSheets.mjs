// Export the Aseprite source art in `aseprite/` into PNG sprite sheets under
// `assets/`. This is a faithful port of scripts/export_sprite_sheets.py.
//
// All the real work is done by the Aseprite CLI (batch mode), exactly as in
// the Python version — this script only walks the source folder, routes each
// file by filename prefix, and spawns the binary with the right flags. There
// is no image processing here (the Python's PIL import was unused), so no npm
// dependencies are needed. It does require the Aseprite app installed locally;
// this is a dev-only asset-authoring tool, not something CI runs.
//
// Usage: node tools/exportSpriteSheets.mjs [tag]
//   tag — optional case-insensitive substring filter on the filename.
// Set ASEPRITE_PATH to point at a non-default Aseprite install.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, basename } from "node:path";

const asepritePath = process.env.ASEPRITE_PATH
  || "/Applications/Aseprite.app/Contents/MacOS/aseprite";
const asepriteAssets = "aseprite";
const pngsFolder = "assets";

function run(args, label) {
  const result = spawnSync(asepritePath, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`Error exporting ${label}: ${result.error.message}`);
  } else if (result.status !== 0) {
    console.error(`Error exporting ${label}: aseprite exited ${result.status}`);
  } else {
    console.log(`Exported ${label}`);
  }
}

function assetNameFromFilePath(filePath) {
  let assetName = basename(filePath).split(".")[0];
  if (assetName.endsWith("-")) assetName = assetName.slice(0, -1);
  return assetName;
}

function exportBuilding(filePath, destinationFolder) {
  const outputPath = join(destinationFolder, `${assetNameFromFilePath(filePath)}.png`);
  run(["-b", filePath, "--all-layers", "--sheet", outputPath], `building asset: ${outputPath}`);
}

function exportWeapons(filePath, destinationFolder) {
  const outputPath = join(destinationFolder, `${assetNameFromFilePath(filePath)}.png`);
  run([
    "-b", filePath,
    "--layer", "Slashes",
    "--layer", "Weapons",
    "--ignore-layer", "Reference",
    "--save-as", outputPath,
  ], `weapons asset: ${outputPath}`);
}

function exportCharacter(filePath, destinationFolder) {
  const outputPath = join(destinationFolder, `${assetNameFromFilePath(filePath)}.png`);
  run(["-b", filePath, "--all-layers", "--sheet", outputPath], `character asset: ${outputPath}`);
}

function exportAseprite(filePath, destinationFolder) {
  const filename = basename(filePath);

  if (filename.includes(".bak.")) return;

  if (filename.startsWith("building") || filename.startsWith("demon_lord_defeat")) {
    exportBuilding(filePath, destinationFolder);
  } else if (filename.startsWith("weapons")) {
    exportWeapons(filePath, destinationFolder);
  } else if (filename.startsWith("tiles")) {
    return;
  } else {
    exportCharacter(filePath, destinationFolder);
  }
}

function findAsepriteFiles(folder, tag) {
  const paths = [];
  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();
    if (name.includes(tag) && (name.endsWith(".aseprite") || name.endsWith(".ase"))) {
      paths.push(join(entry.parentPath ?? folder, entry.name));
    }
  }
  return paths;
}

function exportAll(tag, rootFolder, destinationFolder) {
  console.log(`Looking for *.aseprite and *.ase files in ${rootFolder}...`);
  if (tag !== "") console.log(`Also filtering by \`${tag}\``);
  const files = findAsepriteFiles(rootFolder, tag);
  console.log(`Found ${files.length} files`);
  files.forEach((file, i) => {
    console.log(`Exporting file ${i + 1} out of ${files.length}`);
    exportAseprite(file, destinationFolder);
  });
  console.log("All done!");
}

const tag = (process.argv[2] ?? "").toLowerCase();
exportAll(tag, asepriteAssets, pngsFolder);
