// Production build — bundles the module graph into one content-hashed file
// and assembles a self-contained publish dir (_site/) for the VPS deploy.
//
// Why a build at all: dev and the e2e harness load raw ES modules straight
// from js/ (no build), but production used to cache-bust by pinning
// `?v=<date>` to all ~660 imports via sed. esbuild replaces that: the
// bundle's filename carries a content hash, so caches invalidate
// automatically and only when the bytes change, and first load drops from
// 112 module fetches to one.
//
//   node tools/build.mjs        # writes _site/
//
// Runtime asset/data loads (./data/*.json, assets/*) are fetched against the
// document base, not bundled — so they're copied verbatim into _site/
// alongside the static landing page (root index.html) and the rewritten game
// shell (play/index.html). The only devDependency is esbuild; everything else
// is node: built-ins.

import * as esbuild from "esbuild";
import { rmSync, cpSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const OUT_DIR = join(REPO_ROOT, "_site");

// Top-level entries that must NOT ship: source modules (bundled instead),
// tooling, tests, the server, VCS/CI/editor metadata, and dev cruft. Anything
// else at the repo root (data/, assets/, docs/, favicon, …) is copied as-is,
// so a newly added runtime asset ships without touching this script.
const DENYLIST = new Set([
  "js", "tests", "tools", "server", "node_modules", "docs",
  ".git", ".github", ".claude", "venv", "__pycache__", "_site",
  ".gitignore", "package.json", "package-lock.json",
  // Desktop (Electron/Steam) wrapper — built separately, never part of the web bundle.
  "electron", "dist",
  // Build scratch + Steam packaging scratch — never runtime assets.
  "temp", "build",
]);

function isDenied(name) {
  if (DENYLIST.has(name)) return true;
  // Any dotenv file (.env, .env.local, .env.production, …) holds secrets and
  // must never ship — match the whole family, not just the literal ".env".
  if (name === ".env" || name.startsWith(".env.")) return true;
  // Docs/dev cruft — never part of the runtime.
  if (name.endsWith(".log") || name.endsWith(".py") || name.endsWith(".md")) return true;
  return false;
}

// Rewrite a `from` substring to `to` in an already-copied _site/ HTML file, in
// place. Throws if the marker isn't found (entry path drifted) so a silent
// no-op can't ship a page pointing at a non-existent raw module.
function rewriteScript(htmlPath, from, to) {
  const src = readFileSync(htmlPath, "utf8");
  const out = src.replace(from, to);
  if (out === src) throw new Error(`build: '${from}' not found in ${htmlPath} (script tag changed?)`);
  writeFileSync(htmlPath, out);
}

async function build() {
  rmSync(OUT_DIR, { recursive: true, force: true });

  const result = await esbuild.build({
    // Two entries: the game shell (js/main.js, loaded by /play/) and the
    // marketing-site account UI (js/siteAccount.js, loaded by / and /account/).
    // Both must be bundled because js/ is denylisted from _site/ — raw module
    // loads would 404 in production.
    entryPoints: [join(REPO_ROOT, "js/main.js"), join(REPO_ROOT, "js/siteAccount.js")],
    bundle: true,
    format: "esm",
    minify: true,
    sourcemap: true,
    target: "es2022",
    entryNames: "[name]-[hash]",
    // Code-splitting so the opt-in autoplay bot (dynamically imported by
    // main.js under ?autoplay) lands in its OWN lazy chunk instead of the
    // player bundle, while still sharing the engine's module instances via
    // shared chunks (the bot must drive the same input/storage/state
    // singletons the game reads). Chunk filenames are content-hashed.
    splitting: true,
    chunkNames: "chunk-[hash]",
    outdir: OUT_DIR,
    metafile: true,
    logLevel: "info",
  });

  // Find each hashed entry output (the .js, not its .map) from the metafile.
  const bundleFor = (entryPoint) => {
    const entry = Object.entries(result.metafile.outputs)
      .find(([, o]) => o.entryPoint === entryPoint);
    if (!entry) throw new Error(`build: could not locate ${entryPoint} output in metafile`);
    return entry[0].split("/").pop(); // e.g. main-AB12CD34.js
  };
  const bundleName = bundleFor("js/main.js");
  const siteBundle = bundleFor("js/siteAccount.js");

  // Bundle guard: the opt-in autoplay bot must stay OUT of the player entry
  // bundles (it's a lazy chunk fetched only under ?autoplay) yet still be
  // emitted as a chunk that shares the engine modules. Assert both, so a
  // refactor that accidentally static-imports the bot — shipping it to every
  // player, or worse splitting it into a dead second copy of the engine
  // singletons — fails the build loudly.
  const outputs = Object.entries(result.metafile.outputs);
  const inputsOf = (file) => Object.keys(outputs.find(([f]) => f === file)?.[1]?.inputs ?? {});
  const isAutoplay = (i) => i.includes("js/autoplay/");
  for (const entry of ["js/main.js", "js/siteAccount.js"]) {
    const file = outputs.find(([, o]) => o.entryPoint === entry)?.[0];
    if (file && inputsOf(file).some(isAutoplay)) {
      throw new Error(`build: autoplay bot leaked into the ${entry} player bundle — keep it behind the dynamic import()`);
    }
  }
  const botChunk = outputs.find(([, o]) => Object.keys(o.inputs || {}).some((i) => i.endsWith("js/autoplay/bot.js")));
  if (!botChunk) throw new Error("build: autoplay bot chunk missing — the dynamic import() was dropped");

  // Copy every shippable top-level entry into _site/ verbatim — including the
  // landing page (root index.html) and the game shell (play/index.html). The
  // game shell is rewritten in place below; the landing ships as-is.
  const { readdirSync } = await import("node:fs");
  for (const name of readdirSync(REPO_ROOT)) {
    if (isDenied(name)) continue;
    cpSync(join(REPO_ROOT, name), join(OUT_DIR, name), { recursive: true });
  }

  // Rewrite each page's raw module <script src> to its hashed bundle. The game
  // shell and the account page carry <base href="/">, so `./<bundle>` resolves
  // to root where esbuild wrote it; the landing is served at root already.
  rewriteScript(join(OUT_DIR, "play", "index.html"), "./js/main.js", `./${bundleName}`);
  rewriteScript(join(OUT_DIR, "index.html"), "./js/siteAccount.js", `./${siteBundle}`);
  rewriteScript(join(OUT_DIR, "account", "index.html"), "./js/siteAccount.js", `./${siteBundle}`);

  console.log(`\nbuilt _site/ — game ${bundleName}, site ${siteBundle}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
