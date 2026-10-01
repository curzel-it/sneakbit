import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadReleaseEnv, localPath, parseEnv } from "../tools/releaseEnv.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the .env reader unquotes values and skips comments", () => {
  const env = parseEnv([
    "# TestFlight",
    "",
    "ASC_KEY_PATH=\"~/keys/AuthKey.p8\"",
    "ANDROID_KEY_ALIAS='key0'",
    "  ANDROID_KEY_PASSWORD = a=b#c  ",
    "not a setting",
  ].join("\r\n"));
  assert.deepEqual(env, { ASC_KEY_PATH: "~/keys/AuthKey.p8", ANDROID_KEY_ALIAS: "key0", ANDROID_KEY_PASSWORD: "a=b#c" });
});

test("release paths expand the home folder and resolve against the repo", () => {
  assert.equal(localPath("~/it.keystore"), join(homedir(), "it.keystore"));
  assert.equal(localPath("play-service-account.json"), join(ROOT, "play-service-account.json"));
  assert.equal(localPath("/Volumes/Archives"), "/Volumes/Archives");
});

test("a release names every missing key and every missing path before it starts", () => {
  const dir = mkdtempSync(join(tmpdir(), "sneakbit-release-env-"));
  const envPath = join(dir, ".env");
  try {
    assert.throws(() => loadReleaseEnv(["A"], [], envPath), /missing .*\.env/);
    writeFileSync(envPath, `A=1\nKEY_PATH=${join(dir, "absent.p8")}\n`);
    assert.throws(() => loadReleaseEnv(["A", "B", "C"], [], envPath), /missing B, C in /);
    assert.throws(() => loadReleaseEnv(["A", "KEY_PATH"], ["KEY_PATH"], envPath), /KEY_PATH does not exist: .*absent\.p8/);
    writeFileSync(join(dir, "absent.p8"), "");
    assert.equal(loadReleaseEnv(["A", "KEY_PATH"], ["KEY_PATH"], envPath).A, "1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
