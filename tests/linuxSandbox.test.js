// The decision table behind the Linux --no-sandbox fallback. The cases that
// matter are the two ends: a Steam install on a locked-down distro must get
// the fallback (otherwise the game never opens a window), and a system where
// either sandbox mechanism still works must not.

import { test } from "node:test";
import assert from "node:assert/strict";

import { needsNoSandbox } from "../electron/linuxSandbox.js";

const SETUID_ROOT = { uid: 0, mode: 0o104755 };
const PLAIN_FILE = { uid: 1000, mode: 0o100755 };

// Nothing readable / nothing restrictive: the namespace sandbox is presumed up.
const OPEN_SYSCTLS = {
  maxUserNamespaces: null,
  unprivilegedUsernsClone: null,
  apparmorRestrictUserns: null,
};

const decide = (overrides) =>
  needsNoSandbox({ platform: "linux", helper: PLAIN_FILE, sysctls: OPEN_SYSCTLS, ...overrides });

test("other platforms never get the fallback", () => {
  for (const platform of ["darwin", "win32"]) {
    assert.equal(decide({ platform, helper: null, sysctls: { ...OPEN_SYSCTLS, maxUserNamespaces: 0 } }), false);
  }
});

test("a setuid-root helper is left alone, however locked down the kernel is", () => {
  assert.equal(
    decide({
      helper: SETUID_ROOT,
      sysctls: { maxUserNamespaces: 0, unprivilegedUsernsClone: 0, apparmorRestrictUserns: 1 },
    }),
    false
  );
});

test("a helper that lost its setuid bit is not trusted", () => {
  // Exactly what a Steam depot install looks like: the file is there, 0755.
  assert.equal(decide({ helper: PLAIN_FILE, sysctls: { ...OPEN_SYSCTLS, maxUserNamespaces: 0 } }), true);
  // Setuid bit but not root-owned is no better.
  assert.equal(
    decide({ helper: { uid: 1000, mode: 0o104755 }, sysctls: { ...OPEN_SYSCTLS, maxUserNamespaces: 0 } }),
    true
  );
});

test("the namespace sandbox saves us when the helper can't", () => {
  assert.equal(decide({ helper: null }), false);
  assert.equal(decide({ helper: PLAIN_FILE, sysctls: { ...OPEN_SYSCTLS, maxUserNamespaces: 31231 } }), false);
  assert.equal(decide({ helper: PLAIN_FILE, sysctls: { ...OPEN_SYSCTLS, unprivilegedUsernsClone: 1 } }), false);
  assert.equal(decide({ helper: PLAIN_FILE, sysctls: { ...OPEN_SYSCTLS, apparmorRestrictUserns: 0 } }), false);
});

test("each way of disabling unprivileged user namespaces triggers the fallback", () => {
  // Kernel-wide off switch.
  assert.equal(decide({ sysctls: { ...OPEN_SYSCTLS, maxUserNamespaces: 0 } }), true);
  // Debian's out-of-tree knob.
  assert.equal(decide({ sysctls: { ...OPEN_SYSCTLS, unprivilegedUsernsClone: 0 } }), true);
  // Ubuntu 24.04's AppArmor restriction.
  assert.equal(decide({ sysctls: { ...OPEN_SYSCTLS, apparmorRestrictUserns: 1 } }), true);
});
