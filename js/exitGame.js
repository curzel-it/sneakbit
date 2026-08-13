// "Exit game" — closing the app from inside the pause menu.
//
// Desktop only, and deliberately so. On the web the tab is the player's to
// close (and script-initiated window.close() doesn't work on a page the user
// navigated to anyway); on iOS and Android an app that terminates itself reads
// as a crash to the player and to both stores' review guidelines. That leaves
// the Steam/Electron build, where there's no browser chrome, no home gesture,
// and a fullscreen window whose only other way out is Alt+F4 / Cmd+Q.
//
// The quit itself is one line (js/nativeBridge.js asks the shell). What earns
// this file is the flush in front of it: the process is about to disappear, so
// the usual "fire the write with keepalive on beforeunload" bet — which is
// racing a page teardown, not a dying process — stops being good enough.

import { getNativeState, requestShellQuit } from "./nativeBridge.js";
import { flushMirror } from "./saveMirror.js";
import { flushCloudSave } from "./cloudSave.js";

// Bounds the wait before we quit anyway. A save that hasn't landed by now is
// one of the slow paths (a cloud PUT on a bad connection); localStorage — the
// authoritative copy — was already written synchronously, so leaving without
// the stragglers costs the mirror and the cloud a few seconds of staleness,
// not the player's progress.
const SAVE_FLUSH_TIMEOUT_MS = 2000;

export function canExitGame() {
  return getNativeState()?.platform === "electron";
}

// Persist everything we can, then ask the shell to go down. Resolves false if
// the shell refused or never answered, which leaves the menu up and usable
// rather than pretending the app is closing.
export async function exitGame() {
  if (!canExitGame()) return false;
  await flushSaves();
  return requestShellQuit();
}

async function flushSaves() {
  // Synchronous localStorage write of the live position — the same one the
  // unload path does, done here while the page is still fully alive. Owned by
  // main.js, which is the only module holding the game state.
  try { window.save?.now?.(); } catch { /* a failed save must not block the exit */ }

  // allSettled over thenables rather than bare calls: neither flush should be
  // able to keep the player in a game they asked to leave, whether it fails,
  // hangs, or throws on the way in.
  const pending = Promise.allSettled([
    Promise.resolve().then(flushMirror),
    Promise.resolve().then(flushCloudSave),
  ]);
  let timer = null;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, SAVE_FLUSH_TIMEOUT_MS); });
  await Promise.race([pending, deadline]);
  if (timer !== null) clearTimeout(timer);
}
