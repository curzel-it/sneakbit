// Decides whether the Linux build has to run with --no-sandbox.
//
// Chromium sandboxes renderers one of two ways: the namespace sandbox
// (unprivileged user namespaces, no special permissions needed) or, when that
// isn't available, a setuid-root helper binary — `chrome-sandbox`, shipped
// next to the executable. When neither is usable Chromium doesn't start at
// all: no window, no error, dead before any of our code runs.
//
// This used to predict namespace-sandbox availability by reading kernel knobs
// under /proc/sys. That can't work, because those knobs describe the kernel,
// not this process: Steam runs the game inside its own runtime, where user
// namespaces can be blocked by seccomp or container policy that no sysctl
// reflects. The knobs read "sandbox is fine", Chromium disagreed, and the game
// died silently on every launch from the Steam client while launching the same
// binary from a shell worked.
//
// So we no longer guess. The sandbox is kept only where it is verifiable from
// a stat: a helper that is setuid and root-owned always works. Everywhere else
// — including every Steam install, since depots don't carry the setuid bit —
// we start with --no-sandbox. The renderer only ever loads bundled app://
// content behind the CSP and navigation guards in appProtocol.js / main.js, so
// the fallback isn't opening a door to untrusted code; it's the difference
// between a playable build and a broken one.
//
// SNEAKBIT_SANDBOX overrides the decision either way — "1" keeps the sandbox,
// "0" forces the fallback — so a stuck player can be talked through it from
// Steam's Launch Options (`SNEAKBIT_SANDBOX=0 %command%`) without a patch.
//
// This file takes `app.commandLine` as an argument rather than importing
// electron, which keeps the decision table testable from plain node
// (tests/linuxSandbox.test.js).

import { statSync } from "node:fs";
import { dirname, join } from "node:path";

const SANDBOX_HELPER = "chrome-sandbox";

const S_ISUID = 0o4000;

// The setuid helper only works if it is actually setuid *and* owned by root.
function helperIsUsable(helper) {
  return !!helper && helper.uid === 0 && (helper.mode & S_ISUID) !== 0;
}

// Pure decision. `helper` is {uid, mode} or null when the binary is missing;
// `override` is the raw SNEAKBIT_SANDBOX value, if any.
export function needsNoSandbox({ platform, helper, override }) {
  if (platform !== "linux") return false;
  if (override === "1") return false;
  if (override === "0") return true;
  return !helperIsUsable(helper);
}

function readHelper(execPath) {
  try {
    const { uid, mode } = statSync(join(dirname(execPath), SANDBOX_HELPER));
    return { uid, mode };
  } catch {
    return null;
  }
}

// Call before app ready — command line switches are read once at startup.
// Returns whether the fallback kicked in, so the caller can log it.
export function applyLinuxSandboxFallback(commandLine, execPath = process.execPath) {
  if (process.platform !== "linux") return false;

  const fallback = needsNoSandbox({
    platform: process.platform,
    helper: readHelper(execPath),
    override: process.env.SNEAKBIT_SANDBOX,
  });
  if (fallback) commandLine.appendSwitch("no-sandbox");
  return fallback;
}
