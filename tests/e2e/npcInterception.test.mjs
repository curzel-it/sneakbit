// End-to-end interception through the real module graph + DOM. Boots the
// normal offline game, then drives tickNpcInterception against the LIVE modules
// with a synthetic zone/player: a demands-attention NPC five tiles up the
// column spots the hero, freezes it, walks over, and pops its dialogue via the
// real dialogue overlay. Proves the browser wiring (module loads, the row-8
// mark gate, freeze, approach walk, openDialogueWithEntity → showDialogue) all
// hang together. Self-skips when Chrome isn't installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  skipIfNoChrome, launchChrome, getTargets,
  connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

const STATIC_PORT = 8071;
const RELAY_PORT = 8171;
const CHROME_PORT = 9371;

test("interception: spotted hero freezes, NPC walks over, dialogue opens", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
  t.after(() => servers.stop());
  const chrome = await launchChrome({ port: CHROME_PORT, dataDir: "/tmp/sb-e2e-intercept" });
  t.after(() => chrome.kill());
  const targets = await getTargets(CHROME_PORT);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => {
    errors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown");
  });

  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!document.getElementById('coin-hud')");

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
    const player = { index: 0, tileX: 0, tileY: 6, x: 0, y: 6, direction: 'up' };
    const state = { zone, player, player2: null, players: [] };

    const armed = isDemandingAttention(npc);

    // First tick: should spot the player and freeze them.
    tickNpcInterception(state, 1 / 60);
    const frozeImmediately = player._frozen === true && isInterceptionActive();
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
  assert.equal(result.markClearedWhileMoving, true, "the '!' clears while the NPC walks (walk animation plays)");
  assert.equal(result.walked, true, "the NPC walked from its start tile");
  assert.equal(result.faces, "down", "the NPC ends up facing the player");
  assert.equal(result.stillFrozen, true, "hero stays frozen through the dialogue");
  assert.equal(result.dialogueOpen, true, "the dialogue opened on arrival");
  assert.equal(result.active, true, "interception is flagged active while dialogue is open");
  assert.deepEqual(errors, [], "no uncaught browser exceptions");
});
