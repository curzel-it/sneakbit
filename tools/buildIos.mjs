// iOS build — produces the web bundle and stages it inside the Xcode project
// so the app ships fully self-contained and plays offline on first launch.
//
//   node tools/buildIos.mjs        # (npm run build-ios)
//
// Staging runs the normal production build (tools/build.mjs) and copies the
// runtime subset of _site/ into ios/web/, a folder reference bundled verbatim
// into the app (see ios/SneakBit.xcodeproj). The iOS app serves that tree over
// the custom app:// scheme (BundleSchemeHandler), the way the Electron desktop
// wrapper serves _site/ over app://. See tools/stageWebRuntime.mjs for what the
// staged subset contains and why.

import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSite, stageRuntime } from "./stageWebRuntime.mjs";
import { bumpBuildNumber } from "./buildNumber.mjs";
import { bumpElectronVersion } from "./electronVersion.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const IOS_WEB = join(REPO_ROOT, "ios", "web");

/**
 * Stages the web game for the app and moves the build number and Electron version once.
 * @returns {number} the new build number
 */
export function buildIos() {
  buildSite();
  const mb = stageRuntime(IOS_WEB);
  console.log(`build-ios: staged web bundle into ios/web/ (${mb} MB)`);
  const build = bumpBuildNumber(REPO_ROOT);
  console.log(`build-ios: build number ${build}`);
  console.log(`build-ios: electron version ${bumpElectronVersion(REPO_ROOT)}`);
  return build;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  buildIos();
  console.log("build-ios: done — open ios/SneakBit.xcodeproj and Run.");
}
