// Android build — produces the web bundle and stages it inside the Android
// project so the app ships fully self-contained and plays offline on first
// launch.
//
//   node tools/buildAndroid.mjs        # (npm run build-android)
//
// Staging runs the normal production build (tools/build.mjs) and copies the
// runtime subset of _site/ into android/app/src/main/assets/web/. Everything
// under src/main/assets/ is packed into the APK automatically (no Gradle edit
// needed), and MainActivity serves that tree over
// https://appassets.androidplatform.net via WebViewClient.shouldInterceptRequest
// — the Android mirror of the iOS app:// scheme. See tools/stageWebRuntime.mjs
// for what the staged subset contains and why.

import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSite, stageRuntime } from "./stageWebRuntime.mjs";
import { bumpBuildNumber } from "./buildNumber.mjs";
import { bumpElectronVersion } from "./electronVersion.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ANDROID_WEB = join(REPO_ROOT, "android", "app", "src", "main", "assets", "web");

/**
 * Stages the web game for the app and moves the build number and Electron version once.
 * @returns {number} the new build number
 */
export function buildAndroid() {
  buildSite();
  const mb = stageRuntime(ANDROID_WEB);
  console.log(`build-android: staged web bundle into android/app/src/main/assets/web/ (${mb} MB)`);
  const build = bumpBuildNumber(REPO_ROOT);
  console.log(`build-android: build number ${build}`);
  console.log(`build-android: electron version ${bumpElectronVersion(REPO_ROOT)}`);
  return build;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  buildAndroid();
  console.log("build-android: done — open the android/ project in Android Studio and Run,");
  console.log("               or run `cd android && ./gradlew assembleDebug`.");
}
