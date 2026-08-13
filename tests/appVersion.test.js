// The version the player sees and the version the shipped package claims must
// be the same string. The menu renders APP_VERSION; the Steam build
// description, the Electron app version and the mobile shells all come from
// package.json. When those drifted, a bug report saying "v0.4.0" pointed at no
// build anyone could find.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APP_VERSION } from "../js/constants.js";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")
);

test("APP_VERSION matches package.json", () => {
  assert.equal(APP_VERSION, pkg.version);
});

test("APP_VERSION is a plain x.y.z release number", () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});
