// E2E: the dialogue modal is shared, so a guest has to be able to drive it.
//
// The host owns the dialogue (it resolves the lines, grants the reward and
// broadcasts event:dialogueOpen/Advance/Close); the guest's copy is a
// read-only mirror. That left the guest able to *start* a conversation —
// walk up to an NPC, press interact, the host opens it — and then stuck
// staring at line one, because only the host's own keypress advanced it.
//
// Here the guest's interact key is the only input in the whole test: it
// must page the shared dialogue forward on BOTH clients and, on the last
// line, close it on both.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, evalExpr, waitFor } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { startCoopSession, dispatchKey } from "./fixtures/coopSession.mjs";

// Two lines with no dots in them: strings.tr passes unknown keys straight
// through, so these render verbatim and are trivial to assert on.
const LINE_ONE = "e2e first line";
const LINE_TWO = "e2e second line";

// The host's interact cooldown for a guest intent (hostGuests.ACTION_COOLDOWN_MS)
// is 250 ms — space the presses so the second one isn't thrown away as spam.
const INTERACT_GAP_MS = 400;

let servers;
before(async () => {
  if (!findChrome()) return; // tests below self-skip
  servers = await startServers();
});
after(() => { if (servers) servers.stop(); });

// What the dialogue panel currently reads on this client, or null when
// it's closed. Text is revealed by a typewriter, so callers match on
// substrings rather than equality.
function dialogueText(target) {
  return evalExpr(target, `
    (() => {
      const root = document.getElementById('dialogue');
      if (!root || root.style.display === 'none') return null;
      return document.getElementById('dialogue-text')?.textContent ?? null;
    })()
  `);
}

function hostDialogueOpen(host) {
  return evalExpr(host, `
    (async () => {
      const d = await import('./js/dialogue.js');
      return d.isDialogueOpen();
    })()
  `);
}

// Press the guest's own interact key. guestInputForwarder turns the keydown
// into an { op:"input", intent:"interact" } frame; the host routes it into
// interact.tryInteractForSlot, which advances the open dialogue.
async function guestPressesInteract(guest) {
  await evalExpr(guest, dispatchKey("keydown", "e", "KeyE", 69));
  await evalExpr(guest, dispatchKey("keyup", "e", "KeyE", 69));
}

// The host's world tick, probed through a melee cooldown: melee.tickMelee
// runs in the same guarded block as tickMobs / tickCombat, so a cooldown
// that refuses to drain means the mobs aren't moving either.
const HOST_SWING_CD = `
  (async () => {
    const m = await import('./js/melee.js');
    return m.getMeleeCooldown(0).cd;
  })()
`;

test("a guest pages through and closes the shared dialogue", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    entry: "deeplink",
    hostDir: "/tmp/sb-e2e-dlg-host",
    guestDir: "/tmp/sb-e2e-dlg-guest",
  });
  t.after(() => session.stop());

  // The host opens a two-line dialogue — same call interact.js makes when
  // someone talks to an NPC. Not awaited: the promise settles on close.
  await evalExpr(session.host, `
    (async () => {
      const d = await import('./js/dialogue.js');
      d.showDialogue([${JSON.stringify(LINE_ONE)}, ${JSON.stringify(LINE_TWO)}]);
      return true;
    })()
  `);

  // Premise: the host broadcast it and the guest is mirroring line one.
  await waitFor(session.guest, `
    (document.getElementById('dialogue-text')?.textContent || '').includes('first') || null
  `, { timeoutMs: 15000 });
  assert.match(await dialogueText(session.host), /first/);

  await new Promise((r) => setTimeout(r, INTERACT_GAP_MS));
  await guestPressesInteract(session.guest);

  // The guest's press must move BOTH clients onto line two.
  await waitFor(session.host, `
    (document.getElementById('dialogue-text')?.textContent || '').includes('second') || null
  `, { timeoutMs: 15000 });
  await waitFor(session.guest, `
    (document.getElementById('dialogue-text')?.textContent || '').includes('second') || null
  `, { timeoutMs: 15000 });

  await new Promise((r) => setTimeout(r, INTERACT_GAP_MS));
  await guestPressesInteract(session.guest);

  // Past the last line the dialogue closes — on the host (authoritative)
  // and, via event:dialogueClose, on the guest.
  await waitFor(session.host, `
    (async () => {
      const d = await import('./js/dialogue.js');
      return d.isDialogueOpen() ? null : true;
    })()
  `, { timeoutMs: 15000 });
  await waitFor(session.guest, `
    (document.getElementById('dialogue')?.style.display === 'none') || null
  `, { timeoutMs: 15000 });

  assert.equal(await hostDialogueOpen(session.host), false);
  assert.equal(await dialogueText(session.guest), null);
});

// A dialogue is modal for everyone: the host feeds its own avatar neutral
// input while one is up, and every guest freezes its predicted self. The
// monsters didn't get the memo — they kept moving and biting through the
// whole conversation, so a chat with an NPC could kill a party that had no
// way to move or fight back. The host now freezes the shared sim for as
// long as the dialogue is open (and only for a dialogue — a menu or a shop
// is host-local and must not strand guests in a dead zone).
test("the shared world stops while a dialogue is open, and resumes on close", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    entry: "deeplink",
    hostDir: "/tmp/sb-e2e-dlgpause-host",
    guestDir: "/tmp/sb-e2e-dlgpause-guest",
  });
  t.after(() => session.stop());

  // Open a one-line dialogue, then arm a swing behind it. A swing is 0.35 s
  // of cooldown; the sim would drain it well inside the sample gap below.
  await evalExpr(session.host, `
    (async () => {
      const d = await import('./js/dialogue.js');
      const eq = await import('./js/equipment.js');
      const m = await import('./js/melee.js');
      d.showDialogue([${JSON.stringify(LINE_ONE)}]);
      eq.setEquipped(eq.SLOT_MELEE, 1159, 0);
      m.tryMelee();
      return true;
    })()
  `);

  const armed = await evalExpr(session.host, HOST_SWING_CD);
  assert.ok(armed > 0, `swing should be armed, got ${armed}`);
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(await evalExpr(session.host, HOST_SWING_CD), armed,
    "the host's tick must be frozen while the dialogue is up");

  // Close it the way a player would, and the world picks up where it left off.
  await evalExpr(session.host, `
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true })) || true
  `);
  await waitFor(session.host, `
    (async () => {
      const d = await import('./js/dialogue.js');
      return d.isDialogueOpen() ? null : true;
    })()
  `, { timeoutMs: 15000 });

  await waitFor(session.host, `${HOST_SWING_CD}.then(cd => cd === 0 ? true : null)`,
    { timeoutMs: 15000 });
});
