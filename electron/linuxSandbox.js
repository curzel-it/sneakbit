// Decides whether the Linux build has to run with --no-sandbox.
//
// Chromium sandboxes renderers one of two ways: the namespace sandbox
// (unprivileged user namespaces, no special permissions needed) or, when that
// isn't available, a setuid-root helper binary — `chrome-sandbox`, shipped
// next to the executable. Steam depots don't preserve the setuid bit, so on a
// Steam install that helper is a plain 0755 file. On a distro that also blocks
// unprivileged user namespaces (Ubuntu 24.04 restricts them via AppArmor;
// older Debian shipped them off by default) Chromium finds no usable sandbox
// and refuses to start at all: the game is simply dead on launch.
//
// So: fall back to --no-sandbox, but only where neither mechanism could have
// worked anyway. Where the sandbox is available we keep it. The renderer only
// ever loads bundled app:// content behind the CSP and navigation guards in
// appProtocol.js / main.js, so the fallback isn't opening a door to untrusted
// code — it's the difference between a playable build and a broken one.
//
// This file takes `app.commandLine` as an argument rather than importing
// electron, which keeps the decision table testable from plain node
// (tests/linuxSandbox.test.js).

import { statSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SANDBOX_HELPER = "chrome-sandbox";

// Kernel knobs that gate the namespace sandbox. Values are read as numbers;
// anything unreadable (file absent on this kernel) reads as null and is taken
// as "this knob isn't the one stopping us".
const SYSCTLS = {
  maxUserNamespaces: "/proc/sys/user/max_user_namespaces",
  // Debian's out-of-tree knob; absent on mainline kernels.
  unprivilegedUsernsClone: "/proc/sys/kernel/unprivileged_userns_clone",
  // Ubuntu 24.04+: 1 means unprivileged userns is AppArmor-restricted.
  apparmorRestrictUserns: "/proc/sys/kernel/apparmor_restrict_unprivileged_userns",
};

const S_ISUID = 0o4000;

// The setuid helper only works if it is actually setuid *and* owned by root.
function helperIsUsable(helper) {
  return !!helper && helper.uid === 0 && (helper.mode & S_ISUID) !== 0;
}

function namespaceSandboxIsUsable(sysctls) {
  if (sysctls.maxUserNamespaces === 0) return false;
  if (sysctls.unprivilegedUsernsClone === 0) return false;
  if (sysctls.apparmorRestrictUserns === 1) return false;
  return true;
}

// Pure decision. `helper` is {uid, mode} or null when the binary is missing;
// `sysctls` holds numbers or null per key.
export function needsNoSandbox({ platform, helper, sysctls }) {
  if (platform !== "linux") return false;
  if (helperIsUsable(helper)) return false;
  return !namespaceSandboxIsUsable(sysctls);
}

function readHelper(execPath) {
  try {
    const { uid, mode } = statSync(join(dirname(execPath), SANDBOX_HELPER));
    return { uid, mode };
  } catch {
    return null;
  }
}

function readSysctls() {
  const out = {};
  for (const [key, path] of Object.entries(SYSCTLS)) {
    try {
      const value = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
      out[key] = Number.isNaN(value) ? null : value;
    } catch {
      out[key] = null;
    }
  }
  return out;
}

// Call before app ready — command line switches are read once at startup.
// Returns whether the fallback kicked in, so the caller can log it.
export function applyLinuxSandboxFallback(commandLine, execPath = process.execPath) {
  if (process.platform !== "linux") return false;

  const fallback = needsNoSandbox({
    platform: process.platform,
    helper: readHelper(execPath),
    sysctls: readSysctls(),
  });
  if (fallback) commandLine.appendSwitch("no-sandbox");
  return fallback;
}
