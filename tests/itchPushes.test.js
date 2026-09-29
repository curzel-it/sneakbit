import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { planItchPushes, ITCH_TARGET } from "../tools/itchPushes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

test("every platform goes to its own channel with the package version", () => {
  const pushes = planItchPushes("/repo", "2.0.9");
  assert.deepEqual(pushes.map(({ platform }) => platform), ["win", "mac", "linux"]);
  const channels = pushes.map(({ args }) => args[2]);
  assert.equal(new Set(channels).size, 3, "no channel is pushed twice");
  for (const { args } of pushes) {
    assert.equal(args[0], "push");
    assert.ok(args[2].startsWith(`${ITCH_TARGET}:`));
    assert.deepEqual(args.slice(3), ["--userversion", "2.0.9"]);
  }
});

test("pushes can be limited to some platforms", () => {
  assert.deepEqual(planItchPushes("/repo", "1.0.0", ["linux"]).map(({ platform }) => platform), ["linux"]);
  assert.throws(() => planItchPushes("/repo", "1.0.0", ["android"]), /unknown platform/);
});

test("the mac folder follows the arch electron-builder produces", () => {
  const [mac] = planItchPushes("/repo", "1.0.0", ["mac"]);
  assert.ok(mac.dir.endsWith(`mac-${pkg.build.mac.target[0].arch[0]}`));
});
