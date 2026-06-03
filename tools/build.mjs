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
// alongside the rewritten index.html. The only devDependency is esbuild;
// everything else is node: built-ins.

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
  ".gitignore", "deploy.py", "package.json", "package-lock.json",
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

async function build() {
  rmSync(OUT_DIR, { recursive: true, force: true });

  const result = await esbuild.build({
    entryPoints: [join(REPO_ROOT, "js/main.js")],
    bundle: true,
    format: "esm",
    minify: true,
    sourcemap: true,
    target: "es2022",
    entryNames: "app-[hash]",
    outdir: OUT_DIR,
    metafile: true,
    logLevel: "info",
  });

  // Find the hashed entry output (the .js, not its .map) from the metafile.
  const entry = Object.entries(result.metafile.outputs)
    .find(([, o]) => o.entryPoint === "js/main.js");
  if (!entry) throw new Error("build: could not locate entry output in metafile");
  const bundleName = entry[0].split("/").pop(); // e.g. app-AB12CD34.js

  // Copy every shippable top-level entry into _site/ verbatim.
  const { readdirSync } = await import("node:fs");
  for (const name of readdirSync(REPO_ROOT)) {
    if (isDenied(name) || name === "index.html") continue;
    cpSync(join(REPO_ROOT, name), join(OUT_DIR, name), { recursive: true });
  }

  // Rewrite index.html to point at the hashed bundle instead of raw modules.
  const srcHtml = readFileSync(join(REPO_ROOT, "index.html"), "utf8");
  const outHtml = srcHtml.replace("./js/main.js", `./${bundleName}`);
  if (outHtml === srcHtml) throw new Error("build: index.html script tag not rewritten (entry path changed?)");
  writeFileSync(join(OUT_DIR, "index.html"), outHtml);

  console.log(`\nbuilt _site/ — entry ${bundleName}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
