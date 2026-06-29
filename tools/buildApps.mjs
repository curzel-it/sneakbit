// Build the web bundle once and stage it into BOTH native projects (iOS +
// Android) in one shot, so a single command refreshes the bundled game for
// every platform.
//
//   node tools/buildApps.mjs        # (npm run build-apps)
//
// Both wrappers ship the same runtime subset of _site/ (see
// tools/stageWebRuntime.mjs), so we run the web build once and stage it to each
// destination rather than rebuilding per platform.

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite, stageRuntime } from "./stageWebRuntime.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const IOS_WEB = join(REPO_ROOT, "ios", "web");
const ANDROID_WEB = join(REPO_ROOT, "android", "app", "src", "main", "assets", "web");

buildSite();
const iosMb = stageRuntime(IOS_WEB);
const androidMb = stageRuntime(ANDROID_WEB);
console.log(`build-apps: staged web bundle into ios/web/ (${iosMb} MB) and android/app/src/main/assets/web/ (${androidMb} MB)`);
console.log("build-apps: done — open ios/SneakBit.xcodeproj or the android/ project and Run.");
