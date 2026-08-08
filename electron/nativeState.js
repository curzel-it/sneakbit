// The desktop half of the native save bridge (see js/nativeBridge.js).
//
// Two files matter here. The mirror is this build's own save, written to
// userData so a cleared/corrupted localStorage isn't the end of a playthrough.
// The legacy save is `data/save.json` from the Rust build this one replaces —
// Steam updates the same AppID (3360860) in place, and that file lived beside
// the executable rather than in AppData/Application Support, so it's still
// sitting in the install directory after the update. It was never part of a
// depot manifest (the game created it at runtime, and the old packaging script
// stripped it from the build), so Steam leaves it alone.

import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { app } from "electron";

const MIRROR_FILE = "sneakbit-save.json";
const LEGACY_FILE = join("data", "save.json");

// The renderer only ever sends a saveBlob envelope; anything near this size is
// a bug or an attempt to fill the user's disk.
const MAX_MIRROR_BYTES = 256 * 1024;

function mirrorPath() {
  return join(app.getPath("userData"), MIRROR_FILE);
}

// Where the Rust build's save could be, best guess first. `data/save.json` was
// resolved relative to the executable (game/src/features/paths.rs), which is
// the Steam install root on Windows and Linux. On macOS the new build is an
// .app bundle sitting *in* that root, so climb back out of
// SneakBit.app/Contents/MacOS/ to find it. cwd covers a launch from the
// install directory when the exe path is something unexpected.
function legacyCandidates() {
  const exeDir = dirname(app.getPath("exe"));
  return [
    join(exeDir, LEGACY_FILE),
    resolve(exeDir, "..", "..", "..", LEGACY_FILE),
    join(process.cwd(), LEGACY_FILE),
  ];
}

async function readJsonObject(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : null;
  } catch {
    return null;
  }
}

async function readLegacySave() {
  for (const path of legacyCandidates()) {
    const save = await readJsonObject(path);
    if (save) return save;
  }
  return null;
}

// The envelope js/nativeBridge.js expects. `legacy.audio` is null on desktop:
// the old build kept its sound toggles inside save.json itself
// (desktop_only.game_settings.*), not in a separate prefs store like mobile.
export async function buildNativeState() {
  const [mirror, legacySave] = await Promise.all([
    readJsonObject(mirrorPath()),
    readLegacySave(),
  ]);
  return {
    platform: "electron",
    mirror,
    legacy: legacySave ? { save: legacySave, audio: null } : null,
  };
}

// Write via a temp file + rename so a crash mid-write can't leave a truncated
// save — the exact failure mode of the Rust build's File::create-then-write.
export async function writeMirrorFile(text) {
  if (typeof text !== "string" || text.length > MAX_MIRROR_BYTES) return false;
  try { JSON.parse(text); } catch { return false; }

  const target = mirrorPath();
  const tmp = `${target}.tmp`;
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(tmp, text, "utf8");
    await rename(tmp, target);
    return true;
  } catch (err) {
    console.error("[nativeState] mirror write failed", err);
    try { await unlink(tmp); } catch { /* nothing left to clean up */ }
    return false;
  }
}
