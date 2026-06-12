// Executes a solver `push` action against the LIVE engine. A solver push is
// { push: entityId, dir, blockTo: {x,y}, playerTo: {x,y} } and may slide the
// box several tiles along `dir`. The engine moves a box one tile per step
// (player.js pushOneTile): standing on the tile BEHIND the box and stepping
// toward it shoves the box one tile and the player follows into its old
// tile — so the player automatically stays behind the box as it travels.
//
// So execution is: walk to the push-origin (botNav), then tap the push
// direction until the box reaches blockTo. Gates open live as boxes land on
// plates, and botNav reads the live zone, so navigation adapts for free.
// Share-tile pushes (climbing a pinned box) are left to the engine's own
// behavior; if a push wedges we report blocked and the orchestrator replans.

import { makePuzzleNav } from "./botNav.js";

const DIR_DELTA = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

// Bot ticks a box may fail to advance (while we're idle, i.e. not mid-step)
// before we call the push wedged. One push is ~0.22s ≈ 4-5 ticks.
const PUSH_STALL_TICKS = 16;

// Current tile of a pushable entity in the live zone, or null if it's gone.
export function liveBoxTile(zone, entityId) {
  for (const e of zone.entities) {
    if (e.id === entityId && e.frame) return { x: e.frame.x | 0, y: e.frame.y | 0 };
  }
  return null;
}

// The tile a player must stand on to push a box at `box` in `dir`.
export function pushOrigin(box, dir) {
  const [dx, dy] = DIR_DELTA[dir];
  return { x: box.x - dx, y: box.y - dy };
}

// Stateful executor for one push action. tick() returns a movement intent for
// bot.js to apply:
//   { status: "approaching", dir }  — walking to the push-origin
//   { status: "pushing", dir }      — tap `dir` to shove the box
//   { status: "done" }              — box reached blockTo
//   { status: "blocked" }           — couldn't reach origin / box wedged
export function makePusher(model) {
  let action = null;
  let phase = "approach";
  let nav = makePuzzleNav(model);
  let lastOrigin = null;
  let lastBoxKey = null;
  let stallTicks = 0;

  function setPush(a) {
    action = a;
    phase = "approach";
    lastOrigin = null;
    lastBoxKey = null;
    stallTicks = 0;
  }

  // boxLayout: Map<entityId,{x,y}> of live pushable tiles (for the approach
  // pathing, which must route around every box including the one we'll push).
  function tick(player, zone, boxLayout) {
    const box = liveBoxTile(zone, action.push);
    if (!box) return { status: "blocked" };
    if (box.x === action.blockTo.x && box.y === action.blockTo.y) return { status: "done" };

    const origin = pushOrigin(box, action.dir);
    const onOrigin = player.tileX === origin.x && player.tileY === origin.y;

    if (phase === "approach") {
      if (onOrigin) { phase = "push"; lastBoxKey = `${box.x},${box.y}`; stallTicks = 0; }
      else {
        // Re-aim only when the origin moved (the box advanced) — setGoal resets
        // the nav path, so calling it every tick would thrash.
        if (!lastOrigin || lastOrigin.x !== origin.x || lastOrigin.y !== origin.y) {
          nav.setGoal([origin]);
          lastOrigin = origin;
        }
        const r = nav.tick(player, boxLayout);
        if (r.status === "blocked") return { status: "blocked" };
        if (r.status === "arrived") { phase = "push"; lastBoxKey = `${box.x},${box.y}`; stallTicks = 0; return { status: "approaching", dir: null }; }
        return { status: "approaching", dir: r.dir };
      }
    }

    // phase === "push": a monster (or a share-tile climb) can knock us off the
    // origin — re-approach if so.
    if (!onOrigin) { phase = "approach"; lastOrigin = null; return { status: "approaching", dir: null }; }

    const boxKey = `${box.x},${box.y}`;
    if (boxKey !== lastBoxKey) { lastBoxKey = boxKey; stallTicks = 0; }
    else if (!player.step) {
      stallTicks++;
      if (stallTicks > PUSH_STALL_TICKS) return { status: "blocked" };
    }
    return { status: "pushing", dir: action.dir };
  }

  return { setPush, tick };
}
