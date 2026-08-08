// E2E: the one-time save import that carries players over from the Rust build.
//
// The whole point of the 2.0 release is that nobody loses a playthrough, and
// the unit tests only cover the pieces — this drives the real boot: the game
// asks the shell for its state, translates the old save.json, replaces the kv
// namespace, reloads, and comes up standing in the zone the player left off in.
//
// It also pins the two ways this could go wrong in the field: importing twice
// (which would throw away progress made since), and never mirroring the save
// back out (which would leave the shell's file stale).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  findChrome, skipIfNoChrome, launchChrome, getTargets, connectSession,
  evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startFakeShell } from "./fixtures/fakeShellServer.mjs";

// A save from the old build: partway through the game, some inventory, a
// dialogue answered, sound on and Italian selected. Keys are in the Rust
// build's naming — latest_world, world.visited.*, currently_equipped_* — so
// the translation is exercised for real.
const LEGACY_ENVELOPE = {
  platform: "electron",
  mirror: null,
  legacy: {
    save: {
      build_number: 73,
      always: 1,
      latest_world: 1011,
      previous_world: 1001,
      language: 2,
      "world.visited.1001": 1,
      "world.visited.1011": 1,
      "player.0.currently_equipped_melee_weapon": 1159,
      "player.0.inventory.amount.7000": 12,
      "dialogue.answer.lore.011.hero_profecy.part_1": 1,
      "item_collected.12984092": 1,
    },
    audio: null,
  },
};

const KV = "sneakbit.kv.v1.";

let shell;
before(async () => {
  if (!findChrome()) return;
  shell = await startFakeShell({ envelope: LEGACY_ENVELOPE });
});
after(() => { if (shell) shell.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ls = (s, key) => evalExpr(s, `localStorage.getItem(${JSON.stringify(key)})`);

test("a native shell imports the old build's save once, then mirrors it back", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ dataDir: "/tmp/sb-e2e-legacy-import" });
  t.after(() => chrome.kill());
  const page = (await getTargets(chrome.port)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  await navigate(s, `${shell.appUrl}/`);
  // The import reloads the page mid-boot, so wait for the game itself rather
  // than for the first document.
  await waitFor(s, "!!window.save", { timeoutMs: 30000 });

  // Progress landed under this build's key names.
  assert.equal(await ls(s, KV + "latest_zone"), "1011", "latest_world → latest_zone");
  assert.equal(await ls(s, KV + "did_visit.1011"), "1", "world.visited.<id> → did_visit.<id>");
  assert.equal(await ls(s, KV + "player.0.equipped.melee"), "1159");
  assert.equal(await ls(s, KV + "player.0.inventory.amount.7000"), "12");
  assert.equal(await ls(s, KV + "dialogue.answer.lore.011.hero_profecy.part_1"), "1");
  assert.equal(await ls(s, KV + "item_collected.12984092"), "1");

  // Engine bookkeeping stayed out.
  assert.equal(await ls(s, KV + "always"), null);
  assert.equal(await ls(s, KV + "previous_world"), null);

  // latest_zone surviving a completed boot is proof the zone actually loaded:
  // main.js drops a save pointing at a zone it can't load, falls back to the
  // starting zone, and heals the key on the way out (js/main.js:493-497, 533).
  // A stale 1011 here would have been rewritten to 1001.

  // Settings came across, and the player isn't dropped into silence by the
  // first-launch default.
  const settings = JSON.parse(await ls(s, "sneakbit.settings.v1"));
  assert.equal(settings.language, "it", "old language enum 2 → it");
  assert.equal(settings.muted, false, "they had sound on in the old game");

  // The save is mirrored back to the shell so localStorage isn't the only copy.
  await evalExpr(s, "window.saveMirror.flush()");
  await sleep(300);
  assert.ok(shell.mirrorWrites.length >= 1, "the shell was handed a copy of the save");
  const mirrored = JSON.parse(shell.mirrorWrites.at(-1));
  assert.equal(mirrored.kv.latest_zone, "1011");

  // Second launch: the shell still offers the same legacy save, but this
  // device has moved on. Re-importing would throw that progress away.
  await evalExpr(s, `localStorage.setItem(${JSON.stringify(KV + "item_collected.777")}, "1")`);
  await navigate(s, `${shell.appUrl}/`);
  await waitFor(s, "!!window.save", { timeoutMs: 30000 });
  assert.equal(await ls(s, KV + "item_collected.777"), "1",
    "progress made after the import survives the next boot");
});

test("a shell with nothing on disk boots a new game", async (t) => {
  if (!skipIfNoChrome(t)) return;
  shell.setEnvelope({ platform: "electron", mirror: null, legacy: null });

  const chrome = await launchChrome({ dataDir: "/tmp/sb-e2e-legacy-empty" });
  t.after(() => chrome.kill());
  const page = (await getTargets(chrome.port)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  await navigate(s, `${shell.appUrl}/`);
  await waitFor(s, "!!window.save", { timeoutMs: 30000 });

  assert.equal(await ls(s, KV + "latest_zone"), "1001", "starting zone, as for any new player");
  assert.equal(await ls(s, "sneakbit.legacyImport.v1"), "1",
    "the decision is stamped either way, so the boot never looks again");
});
