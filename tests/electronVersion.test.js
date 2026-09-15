import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bumpElectronVersion } from "../tools/electronVersion.mjs";

const MANIFEST = `{
  "name": "sneakbit",
  "version": "2.0.9",
  "build": {
    "mac": { "target": [{ "target": "dir", "arch": ["arm64"] }] }
  },
  "devDependencies": {
    "electron": "^42.3.2"
  }
}
`;

const LOCK = {
  name: "sneakbit",
  version: "2.0.9",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": { name: "sneakbit", version: "2.0.9" },
    "node_modules/electron": { version: "42.3.2" },
  },
};

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "sneakbit-electron-version-"));
  const write = (path, text) => writeFileSync(join(root, path), text);
  write("package.json", MANIFEST);
  write("package-lock.json", JSON.stringify(LOCK, null, 2) + "\n");
  return { root, write, read: (path) => readFileSync(join(root, path), "utf8") };
}

test("the patch moves in package.json and the lockfile follows", () => {
  const { root, read } = makeRoot();
  try {
    assert.equal(bumpElectronVersion(root), "2.0.10");
    assert.equal(read("package.json"), MANIFEST.replace('"version": "2.0.9"', '"version": "2.0.10"'));
    const lock = JSON.parse(read("package-lock.json"));
    assert.equal(lock.version, "2.0.10");
    assert.equal(lock.packages[""].version, "2.0.10");
    assert.equal(lock.packages["node_modules/electron"].version, "42.3.2");
    assert.equal(bumpElectronVersion(root), "2.0.11");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a manifest without a version fails before the lockfile is written", () => {
  const { root, write, read } = makeRoot();
  try {
    write("package.json", '{\n  "name": "sneakbit"\n}\n');
    assert.throws(() => bumpElectronVersion(root), /package\.json has no major\.minor\.patch version/);
    assert.equal(JSON.parse(read("package-lock.json")).version, "2.0.9");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
