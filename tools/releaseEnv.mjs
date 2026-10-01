import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");

/** @param {string} text @returns {Record<string, string>} */
export function parseEnv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[line.slice(0, equals).trim()] = value;
  }
  return env;
}

/** Expands `~` and resolves relative paths against the repo root. @param {string} path */
export function localPath(path) {
  const expanded = path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(expanded) ? expanded : resolve(ROOT, expanded);
}

/**
 * Reads the release credentials from .env, naming every missing key and every path that is not there.
 * @param {string[]} keys
 * @param {string[]} pathKeys
 * @param {string} [envPath]
 * @returns {Record<string, string>}
 */
export function loadReleaseEnv(keys, pathKeys, envPath = ENV_PATH) {
  if (!existsSync(envPath)) throw new Error(`missing ${envPath}`);
  const env = parseEnv(readFileSync(envPath, "utf8"));
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) throw new Error(`missing ${missing.join(", ")} in ${envPath}`);
  for (const key of pathKeys) {
    if (!existsSync(localPath(env[key]))) throw new Error(`${key} does not exist: ${localPath(env[key])}`);
  }
  return env;
}
