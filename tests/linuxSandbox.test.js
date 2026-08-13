// The decision table behind the Linux --no-sandbox fallback. The rule is that
// the sandbox is kept only where a stat proves it works, because anything we
// infer about the namespace sandbox can be wrong inside Steam's runtime — and
// being wrong there means the game never opens a window.

import { test } from "node:test";
import assert from "node:assert/strict";

import { needsNoSandbox } from "../electron/linuxSandbox.js";

const SETUID_ROOT = { uid: 0, mode: 0o104755 };
const PLAIN_FILE = { uid: 1000, mode: 0o100755 };

const decide = (overrides) =>
  needsNoSandbox({ platform: "linux", helper: PLAIN_FILE, override: undefined, ...overrides });

test("other platforms never get the fallback", () => {
  for (const platform of ["darwin", "win32"]) {
    assert.equal(decide({ platform, helper: null }), false);
    assert.equal(decide({ platform, helper: null, override: "0" }), false);
  }
});

test("a setuid-root helper is left alone", () => {
  assert.equal(decide({ helper: SETUID_ROOT }), false);
});

test("a helper that lost its setuid bit is not trusted", () => {
  // Exactly what a Steam depot install looks like: the file is there, 0755.
  assert.equal(decide({ helper: PLAIN_FILE }), true);
  // Setuid bit but not root-owned is no better.
  assert.equal(decide({ helper: { uid: 1000, mode: 0o104755 } }), true);
});

test("a missing helper falls back rather than betting on the namespace sandbox", () => {
  // The old code kept the sandbox here on the strength of /proc/sys knobs.
  // Inside Steam's runtime those knobs don't describe what the process can do,
  // so the bet lost and the game exited before printing anything.
  assert.equal(decide({ helper: null }), true);
});

test("SNEAKBIT_SANDBOX overrides the decision in both directions", () => {
  assert.equal(decide({ helper: PLAIN_FILE, override: "1" }), false);
  assert.equal(decide({ helper: SETUID_ROOT, override: "0" }), true);
});

test("an unset or unrecognised override changes nothing", () => {
  for (const override of [undefined, "", "yes", "true"]) {
    assert.equal(decide({ helper: SETUID_ROOT, override }), false);
    assert.equal(decide({ helper: PLAIN_FILE, override }), true);
  }
});
