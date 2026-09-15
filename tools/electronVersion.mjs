import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = /^ {2}"version": "(\d+\.\d+\.\d+)"/m;

/**
 * Moves the patch of the version Electron ships under, in package.json and its lockfile.
 * @param {string} root
 * @returns {string} the new version
 */
export function bumpElectronVersion(root) {
  const manifestPath = join(root, "package.json");
  const manifest = readFileSync(manifestPath, "utf8");
  const current = manifest.match(VERSION)?.[1];
  if (!current) throw new Error("package.json has no major.minor.patch version");
  const next = current.replace(/\d+$/, (patch) => String(Number(patch) + 1));

  const lockPath = join(root, "package-lock.json");
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : null;

  writeFileSync(manifestPath, manifest.replace(VERSION, `  "version": "${next}"`));
  if (lock) {
    lock.version = next;
    if (lock.packages?.[""]) lock.packages[""].version = next;
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  }
  return next;
}
