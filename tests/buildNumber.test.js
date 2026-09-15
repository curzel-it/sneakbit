import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { bumpBuildNumber } from "../tools/buildNumber.mjs";

const PBXPROJ = "ios/SneakBit.xcodeproj/project.pbxproj";
const GRADLE = "android/app/build.gradle.kts";

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "sneakbit-build-number-"));
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(PBXPROJ, "CURRENT_PROJECT_VERSION = 7;\nMARKETING_VERSION = 2.0.0;\nCURRENT_PROJECT_VERSION = 7;\n");
  write(GRADLE, '// versionCode 3\nversionCode = 9\nversionName = "2.0.0"\n');
  return { root, write, read: (path) => readFileSync(join(root, path), "utf8") };
}

test("both projects move to one past the higher build number", () => {
  const { root, read } = makeRoot();
  try {
    assert.equal(bumpBuildNumber(root), 10);
    assert.equal(read(PBXPROJ), "CURRENT_PROJECT_VERSION = 10;\nMARKETING_VERSION = 2.0.0;\nCURRENT_PROJECT_VERSION = 10;\n");
    assert.equal(read(GRADLE), '// versionCode 3\nversionCode = 10\nversionName = "2.0.0"\n');
    assert.equal(bumpBuildNumber(root), 11);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a project without a build number fails before anything is written", () => {
  const { root, write, read } = makeRoot();
  try {
    write(GRADLE, 'versionName = "2.0.0"\n');
    assert.throws(() => bumpBuildNumber(root), /build\.gradle\.kts has no build number/);
    assert.match(read(PBXPROJ), /CURRENT_PROJECT_VERSION = 7;/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
