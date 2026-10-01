#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createSign } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildAndroid } from "./buildAndroid.mjs";
import { loadReleaseEnv, localPath } from "./releaseEnv.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID = join(ROOT, "android");
const BUNDLE = join(ANDROID, "app/build/outputs/bundle/release/app-release.aab");
const PACKAGE_NAME = "it.curzel.bitscape";
const TRACK = "internal";

const KEYS = ["ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD", "PLAY_SERVICE_ACCOUNT_PATH"];
const PATH_KEYS = ["ANDROID_KEYSTORE_PATH", "PLAY_SERVICE_ACCOUNT_PATH"];
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications";

/**
 * Gradle reads ORG_GRADLE_PROJECT_* variables as project properties, which keeps the passwords
 * out of the process list.
 * @param {Record<string, string>} env
 */
export function signingEnvironment(env) {
  return {
    "ORG_GRADLE_PROJECT_android.injected.signing.store.file": localPath(env.ANDROID_KEYSTORE_PATH),
    "ORG_GRADLE_PROJECT_android.injected.signing.store.password": env.ANDROID_KEYSTORE_PASSWORD,
    "ORG_GRADLE_PROJECT_android.injected.signing.key.alias": env.ANDROID_KEY_ALIAS,
    "ORG_GRADLE_PROJECT_android.injected.signing.key.password": env.ANDROID_KEY_PASSWORD,
  };
}

/**
 * @param {{client_email: string, private_key: string, private_key_id?: string, token_uri?: string}} account
 * @param {number} [now]
 */
export function serviceAccountAssertion(account, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = part({ alg: "RS256", typ: "JWT", kid: account.private_key_id });
  const claims = part({ iss: account.client_email, scope: SCOPE, aud: account.token_uri || TOKEN_URL, iat: issued, exp: issued + 3600 });
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key, "base64url");
  return `${header}.${claims}.${signature}`;
}

/** @param {number} build @param {string} versionName @param {"completed" | "draft"} status */
export function trackRelease(build, versionName, status) {
  return {
    track: TRACK,
    releases: [{ name: `${build} (${versionName})`, versionCodes: [String(build)], status }],
  };
}

/** @param {{client_email: string, private_key: string, token_uri?: string}} account */
async function accessToken(account) {
  const response = await fetch(account.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountAssertion(account) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Google refused the service account (${response.status}): ${body.error_description || body.error || "no token"}`);
  }
  return body.access_token;
}

/** @param {string} url @param {string} token @param {RequestInit} [options] */
async function play(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers } });
  const text = await response.text();
  if (response.ok) return text ? JSON.parse(text) : null;
  let message = text;
  try {
    message = JSON.parse(text).error?.message || text;
  } catch { /* not JSON */ }
  const error = new Error(`Google Play returned ${response.status}: ${message}`);
  error.status = response.status;
  throw error;
}

/** @param {string} command @param {string[]} args @param {{cwd: string, env: NodeJS.ProcessEnv}} options */
function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(undefined);
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

/** Signs in and opens an edit, so bad credentials fail before a build number is spent. @param {Record<string, string>} env */
async function openEdit(env) {
  const account = JSON.parse(readFileSync(localPath(env.PLAY_SERVICE_ACCOUNT_PATH), "utf8"));
  const token = await accessToken(account);
  try {
    const edit = await play(`${API}/${PACKAGE_NAME}/edits`, token, { method: "POST", body: "{}" });
    return { token, edit: `${PACKAGE_NAME}/edits/${edit.id}`, account: account.client_email };
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      error.message += `\n  Play Console must list ${account.client_email} under Users and permissions with release rights for ${PACKAGE_NAME}`;
    }
    throw error;
  }
}

async function check() {
  const env = loadReleaseEnv(KEYS, PATH_KEYS);
  const { token, edit, account } = await openEdit(env);
  try {
    const { tracks } = await play(`${API}/${edit}/tracks`, token);
    console.log(`${account} can release ${PACKAGE_NAME}`);
    for (const track of tracks || []) {
      const latest = track.releases?.at(-1);
      console.log(`  ${track.track}: ${latest ? `${latest.name || latest.versionCodes?.join(", ")} (${latest.status})` : "empty"}`);
    }
  } finally {
    await play(`${API}/${edit}`, token, { method: "DELETE" });
  }
}

async function release() {
  const env = loadReleaseEnv(KEYS, PATH_KEYS);
  const { token, edit } = await openEdit(env);
  try {
    const build = buildAndroid();
    const versionName = readFileSync(join(ANDROID, "app/build.gradle.kts"), "utf8").match(/\bversionName = "([^"]+)"/)?.[1] || "?";

    console.log("[1/3] bundle release");
    rmSync(BUNDLE, { force: true });
    await run(join(ANDROID, "gradlew"), [":app:bundleRelease"], { cwd: ANDROID, env: { ...process.env, ...signingEnvironment(env) } });

    console.log("[2/3] upload");
    const uploaded = await play(`${UPLOAD_API}/${edit}/bundles?uploadType=media`, token, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: readFileSync(BUNDLE),
    });
    if (uploaded.versionCode !== build) throw new Error(`Play read version code ${uploaded.versionCode}, expected ${build}`);

    console.log(`[3/3] release to ${TRACK} testing`);
    const putTrack = (status) => play(`${API}/${edit}/tracks/${TRACK}`, token, { method: "PUT", body: JSON.stringify(trackRelease(build, versionName, status)) });
    const status = await putTrack("completed").then(() => "completed", (error) => {
      if (!/draft app/i.test(error.message)) throw error;
      return putTrack("draft").then(() => "draft");
    });
    await play(`${API}/${edit}:commit`, token, { method: "POST" });

    if (status === "draft") console.log(`done -> ${versionName} (${build}) is a draft: Play still treats the app as a draft, so roll it out in Play Console`);
    else console.log(`done -> ${versionName} (${build}) is rolling out to ${TRACK} testers`);
    console.log("commit the build-number and Electron version changes before the next release");
  } catch (error) {
    await play(`${API}/${edit}`, token, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  (process.argv.includes("--check") ? check() : release()).catch((error) => {
    console.error(`playstore: ${error.message}`);
    process.exitCode = 1;
  });
}
