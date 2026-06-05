// End-to-end interception through the real module graph + DOM. Boots the
// normal offline game, then drives npcInterception against the LIVE modules
// with synthetic zones/players. Proves the browser wiring (module loads, the
// row-8 mark gate, freeze, approach walk, openDialogueWithEntity → showDialogue,
// and the no-overshoot halt) all hang together. Self-skips when Chrome isn't
// installed. Each test gets its own page so module state (open dialogue,
// active-interception count) never leaks between scenarios.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  skipIfNoChrome, launchChrome, getTargets,
  connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

// Boot the offline game in a fresh Chrome + static server, returning a CDP
// session and a live array of any uncaught browser exceptions. Cleanup is
// registered on the test context.
async function boot(t, { staticPort, relayPort, chromePort, dataDir }) {
  const servers = await startServers({ staticPort, relayPort });
  t.after(() => servers.stop());
  const chrome = await launchChrome({ port: chromePort, dataDir });
  t.after(() => chrome.kill());
  const targets = await getTargets(chromePort);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());
  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => {
    errors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown");
  });
  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!document.getElementById('coin-hud')");
  return { s, errors };
}

test("interception: spotted hero freezes, NPC walks over, dialogue opens", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const { s, errors } = await boot(t, {
    staticPort: 8071, relayPort: 8171, chromePort: 9371, dataDir: "/tmp/sb-e2e-intercept",
  });

  const result = await evalExpr(s, `(async () => {
    const { tickNpcInterception, isInterceptionActive, isDemandingAttention } = await import('./js/npcInterception.js');
    const { isDialogueOpen } = await import('./js/dialogue.js');

    // 1×9 clear column. NPC (1×2) foot tile at (0,1); player 5 tiles below.
    const collision = Array.from({ length: 9 }, () => [false]);
    const npc = {
      id: 990001, species_id: 3005, direction: 'down',
      frame: { x: 0, y: 0, w: 1, h: 2 },
      demands_attention: true,
      dialogues: [{ text: 'npc.test.hello', key: 'always', expected_value: 0, reward: null }],
      after_dialogue: 'Nothing',
    };
    const zone = { id: 1, cols: 1, rows: 9, collision, entities: [npc] };
    // Start the hero facing AWAY from the NPC (which sits above it) so the turn
    // is observable.
    const player = { index: 0, tileX: 0, tileY: 6, x: 0, y: 6, direction: 'down' };
    const state = { zone, player, player2: null, players: [] };

    const armed = isDemandingAttention(npc);

    // First tick: should spot the player, freeze it, and turn it to face the NPC.
    tickNpcInterception(state, 1 / 60);
    const frozeImmediately = player._frozen === true && isInterceptionActive();
    const heroFacesNpc = player.direction;   // NPC is above → hero should face 'up'
    const startX = npc.frame.x, startY = npc.frame.y;

    // The mark must clear the instant it starts moving so the walk animation
    // plays — assert that at some point during the walk npc.moving is true
    // while isDemandingAttention has gone false (no row-8 "!" override).
    let markClearedWhileMoving = false;

    // Run the loop until the dialogue opens (or give up).
    let opened = false;
    for (let i = 0; i < 1200 && !opened; i++) {
      tickNpcInterception(state, 1 / 60);
      if (npc.moving === true && isDemandingAttention(npc) === false) markClearedWhileMoving = true;
      opened = isDialogueOpen();
    }

    return {
      armed,
      frozeImmediately,
      heroFacesNpc,
      markClearedWhileMoving,
      walked: npc.frame.y !== startY || npc.frame.x !== startX,
      faces: npc.direction,                 // should face the player ('down')
      stillFrozen: player._frozen === true,
      dialogueOpen: opened,
      active: isInterceptionActive(),
    };
  })()`);

  assert.equal(result.armed, true, "demands_attention NPC reads as armed");
  assert.equal(result.frozeImmediately, true, "hero freezes the moment it is spotted");
  assert.equal(result.heroFacesNpc, "up", "hero turns to face the approaching NPC");
  assert.equal(result.markClearedWhileMoving, true, "the '!' clears while the NPC walks (walk animation plays)");
  assert.equal(result.walked, true, "the NPC walked from its start tile");
  assert.equal(result.faces, "down", "the NPC ends up facing the player");
  assert.equal(result.stillFrozen, true, "hero stays frozen through the dialogue");
  assert.equal(result.dialogueOpen, true, "the dialogue opened on arrival");
  assert.equal(result.active, true, "interception is flagged active while dialogue is open");
  assert.deepEqual(errors, [], "no uncaught browser exceptions");
});

test("interception: holding the key stops the hero on the line-of-sight tile (no overshoot)", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const { s, errors } = await boot(t, {
    staticPort: 8072, relayPort: 8172, chromePort: 9372, dataDir: "/tmp/sb-e2e-intercept2",
  });

  // Drives the REAL updatePlayer (tile-locked chaining) plus tickNpcInterception
  // in main-loop order, walking the hero up a clear column toward an NPC 8 tiles
  // away with sight range 5. Without the haltPlayer fix the held key chains the
  // next step at the same snap the hero reaches the line-of-sight tile, so it
  // coasts one tile past before the freeze takes hold.
  const walkIn = await evalExpr(s, `(async () => {
    const { tickNpcInterception } = await import('./js/npcInterception.js');
    const { createPlayer, updatePlayer } = await import('./js/player.js');

    const collision = Array.from({ length: 12 }, () => [false]); // 1-wide clear column
    const biome = Array.from({ length: 12 }, () => [0]);         // 0 = non-slippery
    const npc = {
      id: 990002, species_id: 3007, direction: 'down',
      frame: { x: 0, y: 0, w: 1, h: 2 },   // foot at (0,1)
      demands_attention: true,
      dialogues: [{ text: 'npc.test.hello', key: 'always', expected_value: 0, reward: null }],
      after_dialogue: 'Nothing',
    };
    const zone = { id: 2, cols: 1, rows: 12, collision, biome, entities: [npc] };
    const player = createPlayer({ index: 0 });
    Object.assign(player, { tileX: 0, tileY: 9, x: 0, y: 9, direction: 'up' });
    const state = { zone, player, player2: null, players: [] };

    // Hold "up". The NPC foot (0,1) sees down its column; range 5 reaches the
    // player at tileY = 6, so the hero must stop there — never tileY 5.
    const held = new Set(['up']);
    const input = { events: ['up'], held };
    let minTileY = player.tileY;
    for (let i = 0; i < 600 && !player._frozen; i++) {
      updatePlayer(player, input, 1 / 60, zone);          // movement first…
      tickNpcInterception(state, 1 / 60);                 // …then detection (main-loop order)
      input.events = [];                                  // subsequent frames: key just held
      minTileY = Math.min(minTileY, player.tileY);
    }
    // A few more frozen frames to prove it doesn't drift further.
    for (let i = 0; i < 30; i++) {
      updatePlayer(player, input, 1 / 60, zone);
      tickNpcInterception(state, 1 / 60);
      minTileY = Math.min(minTileY, player.tileY);
    }
    return { frozen: player._frozen === true, stopTileY: player.tileY, minTileY, renderY: player.y };
  })()`);

  assert.equal(walkIn.frozen, true, "the walking hero was intercepted");
  assert.equal(walkIn.stopTileY, 6, "hero stops on the line-of-sight tile (6), not one past");
  assert.equal(walkIn.minTileY, 6, "hero never coasts past the line-of-sight tile");
  assert.equal(walkIn.renderY, 6, "render position is snapped to the stop tile (no mid-tile drift)");
  assert.deepEqual(errors, [], "no uncaught browser exceptions");
});
