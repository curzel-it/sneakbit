#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildIos } from "./buildIos.mjs";
import { loadReleaseEnv, localPath } from "./releaseEnv.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.appstoreconnect.apple.com/v1";

const XCODE_PROJECT = "ios/SneakBit.xcodeproj";
const XCODE_SCHEME = "SneakBit";
const BUNDLE_ID = "it.curzel.bitscape";
const ASC_APP_ID = "6737452377";
const BETA_GROUPS = {
  "Internal Users": "bc8240e4-506f-4f04-8880-665f7998babd",
  "Public Link": "e19156ba-7455-464b-821f-adeac2e7d073",
};

const KEYS = ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH", "XCODE_ARCHIVES", "EXPORT_OPTIONS"];
const PATH_KEYS = ["ASC_KEY_PATH", "XCODE_ARCHIVES", "EXPORT_OPTIONS"];
const FAILED_STATES = new Set(["FAILED", "INVALID"]);

/** @param {Record<string, string>} env */
function authentication(env) {
  return [
    "-allowProvisioningUpdates",
    "-authenticationKeyPath", localPath(env.ASC_KEY_PATH),
    "-authenticationKeyID", env.ASC_KEY_ID,
    "-authenticationKeyIssuerID", env.ASC_ISSUER_ID,
  ];
}

/** @param {Record<string, string>} env @param {number} build */
export function archiveArguments(env, build) {
  const archive = join(localPath(env.XCODE_ARCHIVES), `${XCODE_SCHEME}-${build}.xcarchive`);
  return {
    archive,
    args: [
      "archive", "-project", join(ROOT, XCODE_PROJECT), "-scheme", XCODE_SCHEME,
      "-configuration", "Release", "-destination", "generic/platform=iOS", "-archivePath", archive,
      ...authentication(env),
    ],
  };
}

/** @param {Record<string, string>} env @param {string} archive @param {string} exportPath */
export function exportArguments(env, archive, exportPath) {
  return [
    "-exportArchive", "-archivePath", archive, "-exportOptionsPlist", localPath(env.EXPORT_OPTIONS),
    "-exportPath", exportPath, ...authentication(env),
  ];
}

/**
 * An App Store Connect API token, signed with the team key.
 * @param {Record<string, string>} env @param {number} [now]
 */
export function appStoreToken(env, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ alg: "ES256", kid: env.ASC_KEY_ID, typ: "JWT" })}.${part({ iss: env.ASC_ISSUER_ID, iat: issued, exp: issued + 20 * 60, aud: "appstoreconnect-v1" })}`;
  const key = createPrivateKey(readFileSync(localPath(env.ASC_KEY_PATH)));
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${signature.toString("base64url")}`;
}

/** @param {Record<string, string>} env @param {string} path @param {RequestInit} [options] */
async function appStore(env, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${appStoreToken(env)}`, "Content-Type": "application/json", ...options.headers },
  });
  if (response.ok) return response.status === 204 ? null : response.json();
  const body = await response.text();
  throw new Error(`App Store Connect returned ${response.status}${body ? `: ${body}` : ""}`);
}

/** @param {string} command @param {string[]} args */
function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(undefined);
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

/** Signs in and confirms the app, so bad credentials fail before a build number is spent. @param {Record<string, string>} env */
async function signIn(env) {
  const { data } = await appStore(env, `/apps/${ASC_APP_ID}?fields[apps]=name,bundleId`);
  if (data.attributes.bundleId !== BUNDLE_ID) throw new Error(`App Store Connect app ${ASC_APP_ID} is ${data.attributes.bundleId}, expected ${BUNDLE_ID}`);
  return data.attributes.name;
}

/** @param {Record<string, string>} env @param {number} build */
async function waitForBuild(env, build) {
  const deadline = Date.now() + 15 * 60 * 1000;
  const query = new URLSearchParams({ "filter[app]": ASC_APP_ID, "filter[version]": String(build), limit: "5" });
  while (Date.now() < deadline) {
    const response = await appStore(env, `/builds?${query}`);
    const candidate = response.data?.find((item) => item.attributes?.version === String(build));
    const state = candidate?.attributes?.processingState;
    if (state === "VALID") return candidate;
    if (FAILED_STATES.has(state)) throw new Error(`TestFlight processing ended in ${state}`);
    console.log(`  build ${build}: ${state || "waiting for Apple"}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 15000));
  }
  throw new Error(`build ${build} did not finish processing within 15 minutes`);
}

/** @param {Record<string, string>} env @param {string} group @param {string} build */
async function addToGroup(env, group, build) {
  const current = await appStore(env, `/betaGroups/${group}/builds?limit=200`);
  if (current.data?.some((item) => item.id === build)) return;
  await appStore(env, `/betaGroups/${group}/relationships/builds`, {
    method: "POST",
    body: JSON.stringify({ data: [{ type: "builds", id: build }] }),
  });
}

async function check() {
  const env = loadReleaseEnv(KEYS, PATH_KEYS);
  const name = await signIn(env);
  const builds = new URLSearchParams({ "filter[app]": ASC_APP_ID, sort: "-uploadedDate", limit: "3", "fields[builds]": "version,processingState,uploadedDate" });
  const { data: latest } = await appStore(env, `/builds?${builds}`);
  const { data: groups } = await appStore(env, `/apps/${ASC_APP_ID}/betaGroups?fields[betaGroups]=name&limit=50`);
  console.log(`the App Store Connect key can release ${name} (${BUNDLE_ID})`);
  for (const build of latest) console.log(`  build ${build.attributes.version}: ${build.attributes.processingState}, uploaded ${build.attributes.uploadedDate}`);
  for (const [label, id] of Object.entries(BETA_GROUPS)) {
    const found = groups.find((group) => group.id === id);
    if (!found) throw new Error(`beta group ${label} (${id}) is not one of ${name}'s groups`);
    console.log(`  beta group ${found.attributes.name}: ${id}`);
  }
}

async function release() {
  const env = loadReleaseEnv(KEYS, PATH_KEYS);
  await run("xcodebuild", ["-version"]);
  await signIn(env);

  const build = buildIos();
  const { archive, args } = archiveArguments(env, build);
  if (existsSync(archive)) throw new Error(`archive already exists: ${archive}`);
  console.log(`[1/4] archive ${basename(archive)}`);
  await run("xcodebuild", args);

  const exported = mkdtempSync(join(tmpdir(), "sneakbit-testflight-"));
  try {
    console.log("[2/4] export and upload");
    await run("xcodebuild", exportArguments(env, archive, exported));
  } finally {
    rmSync(exported, { recursive: true, force: true });
  }

  console.log("[3/4] wait for TestFlight processing");
  const accepted = await waitForBuild(env, build);
  console.log(`[4/4] distribute to ${Object.keys(BETA_GROUPS).join(" and ")}`);
  for (const group of Object.values(BETA_GROUPS)) await addToGroup(env, group, accepted.id);
  console.log(`done -> TestFlight build ${build} is VALID`);
  console.log(`archive: ${archive}`);
  console.log("commit the build-number and Electron version changes before the next release");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  (process.argv.includes("--check") ? check() : release()).catch((error) => {
    console.error(`testflight: ${error.message}`);
    process.exitCode = 1;
  });
}
