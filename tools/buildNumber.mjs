import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NUMBERS = [
  { path: "ios/SneakBit.xcodeproj/project.pbxproj", pattern: /(?<=\bCURRENT_PROJECT_VERSION = )\d+/g },
  { path: "android/app/build.gradle.kts", pattern: /(?<=\bversionCode = )\d+/g },
];

/**
 * Moves the iOS build number and the Android version code to one past the higher of the two.
 * @param {string} root
 * @returns {number} the new build number
 */
export function bumpBuildNumber(root) {
  const files = NUMBERS.map(({ path, pattern }) => {
    const text = readFileSync(join(root, path), "utf8");
    const found = [...text.matchAll(pattern)].map((match) => Number(match[0]));
    if (!found.length) throw new Error(`${path} has no build number`);
    return { path, pattern, text, found };
  });
  const next = Math.max(...files.flatMap(({ found }) => found)) + 1;
  for (const { path, pattern, text } of files) writeFileSync(join(root, path), text.replace(pattern, String(next)));
  return next;
}
