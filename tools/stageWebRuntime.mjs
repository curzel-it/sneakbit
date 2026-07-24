// Shared helper for the native wrappers (iOS, Android): build the web bundle
// and stage the runtime subset of _site/ into a destination directory that the
// native project bundles verbatim, so the game plays fully offline.
//
// Used by tools/buildIos.mjs and tools/buildAndroid.mjs. Kept in one place so
// the "what does the game actually need at runtime" decision lives once.
//
// We copy a subset, not all of _site/: the game runtime only needs the shell
// (play/index.html), the hashed JS bundle + its chunks at the root, and the
// asset/data trees it fetches at runtime. The marketing landing, account UI,
// source art (aseprite/), trailer media/ and *.map files never run inside the
// app, so they're left out to keep the package small.

import { execFileSync } from "node:child_process";
import { rmSync, cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SITE_DIR = join(REPO_ROOT, "_site");

/** Run the production web build (esbuild bundle + copied runtime assets). */
export function buildSite() {
  console.log("stage-web: running web build…");
  execFileSync("node", [join(HERE, "build.mjs")], { stdio: "inherit", cwd: REPO_ROOT });
}

/**
 * Stage the runtime subset of _site/ into `destDir` (cleared first).
 * Returns the staged size in MB (string, 1 decimal).
 */
export function stageRuntime(destDir) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  // The game shell — play/index.html only (showcase.html is a dev page).
  mkdirSync(join(destDir, "play"), { recursive: true });
  cpSync(join(SITE_DIR, "play", "index.html"), join(destDir, "play", "index.html"));

  // Directory trees fetched at runtime.
  for (const tree of ["assets", "data"]) {
    cpSync(join(SITE_DIR, tree), join(destDir, tree), { recursive: true });
  }

  // Every hashed JS file at the site root: the player bundle (main-*.js), its
  // shared/lazy chunks (chunk-*.js) and the autoplay solver worker
  // (solverWorker.js). Skip .map files — they're a dev aid, not shipped.
  let jsCount = 0;
  for (const name of readdirSync(SITE_DIR)) {
    if (name.endsWith(".js")) {
      cpSync(join(SITE_DIR, name), join(destDir, name));
      jsCount++;
    }
  }
  cpSync(join(SITE_DIR, "favicon.ico"), join(destDir, "favicon.ico"));

  console.log(`stage-web: staged ${jsCount} JS files + assets/data into ${destDir}`);
  return (dirSize(destDir) / (1024 * 1024)).toFixed(1);
}

function dirSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    total += s.isDirectory() ? dirSize(p) : s.size;
  }
  return total;
}
