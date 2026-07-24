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
import { fileURLToPath } from "node:url";
import { buildSite, stageRuntime } from "./stageWebRuntime.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ANDROID_WEB = join(REPO_ROOT, "android", "app", "src", "main", "assets", "web");

buildSite();
const mb = stageRuntime(ANDROID_WEB);
console.log(`build-android: staged web bundle into android/app/src/main/assets/web/ (${mb} MB)`);
console.log("build-android: done — open the android/ project in Android Studio and Run,");
console.log("               or run `cd android && ./gradlew assembleDebug`.");
