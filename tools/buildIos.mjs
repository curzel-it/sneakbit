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
import { fileURLToPath } from "node:url";
import { buildSite, stageRuntime } from "./stageWebRuntime.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const IOS_WEB = join(REPO_ROOT, "ios", "web");

buildSite();
const mb = stageRuntime(IOS_WEB);
console.log(`build-ios: staged web bundle into ios/web/ (${mb} MB)`);
console.log("build-ios: done — open ios/SneakBit.xcodeproj and Run.");
