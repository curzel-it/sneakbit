// Publishes the Electron builds in dist/ to itch.io with butler. Run `npm run dist` first.
//
//   node tools/itch.mjs                 # push win, mac and linux
//   node tools/itch.mjs mac linux       # push only these
//   node tools/itch.mjs --dry-run       # print the pushes without running them

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planItchPushes } from "./itchPushes.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The itch app would otherwise ask Linux players to pick between the launcher and the binary it wraps.
const LINUX_MANIFEST = `[[actions]]
name = "play"
path = "sneakbit"
`;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const platforms = args.filter((arg) => !arg.startsWith("--"));
const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const pushes = planItchPushes(REPO_ROOT, version, platforms.length ? platforms : undefined);

const missing = pushes.filter(({ dir }) => !existsSync(dir));
if (missing.length) {
  console.error(`itch: missing ${missing.map(({ dir }) => dir).join(", ")} — run \`npm run dist\` first`);
  process.exit(1);
}

if (dryRun) {
  for (const { args } of pushes) console.log(`butler ${args.join(" ")}`);
  process.exit(0);
}

if (spawnSync("butler", ["-V"], { stdio: "ignore", shell: process.platform === "win32" }).status !== 0) {
  console.error("itch: butler not found — install it from https://itch.io/docs/butler/ and run `butler login`");
  process.exit(1);
}

for (const { platform, dir, args } of pushes) {
  if (platform === "linux") writeFileSync(join(dir, ".itch.toml"), LINUX_MANIFEST);
  console.log(`itch: pushing ${platform} ${version}`);
  const { status } = spawnSync("butler", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (status !== 0) process.exit(status ?? 1);
}
console.log("itch: done");
