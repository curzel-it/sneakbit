import { join } from "node:path";

export const ITCH_TARGET = "curzel/sneakbit";

const PLATFORMS = {
  win: { dir: "win-unpacked", channel: "windows" },
  mac: { dir: "mac-arm64", channel: "mac" },
  linux: { dir: "linux-unpacked", channel: "linux" },
};

/**
 * The butler pushes that publish each electron-builder output folder to its itch channel.
 * @param {string} root
 * @param {string} version
 * @param {string[]} [platforms]
 * @returns {{ platform: string, dir: string, args: string[] }[]}
 */
export function planItchPushes(root, version, platforms = Object.keys(PLATFORMS)) {
  return platforms.map((platform) => {
    const entry = PLATFORMS[platform];
    if (!entry) throw new Error(`unknown platform '${platform}', expected ${Object.keys(PLATFORMS).join(", ")}`);
    const dir = join(root, "dist", entry.dir);
    return { platform, dir, args: ["push", dir, `${ITCH_TARGET}:${entry.channel}`, "--userversion", version] };
  });
}
