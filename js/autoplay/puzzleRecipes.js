// Authored solutions for the multi-box dungeons whose feasible push sequence
// the general solver can't infer. The region search finds an assignment that's
// reachable in the MODEL but not the live engine (long cross-map pushes that
// would cross a still-closed gate). The zone author knows the real route; we
// encode it as ordered tile WAYPOINTS — push pushable `box` until it sits on
// tile `to` — and the single-box solver computes the micro-pushes for each
// step, with gates opening in the authored order. A box may appear twice (an
// intermediate shove that clears a path, then its final plate). Ids/tiles from
// data/<zone>.json.
//
// Minimal by design: only the dungeons the solver gets wrong need a recipe;
// the 3-box zones (1007/1009/1016) solve correctly on their own.

export const PUZZLE_RECIPES = {
  // 1013 — Yellow → (shove the red box aside) → Blue → Red → Green.
  // The blue box's push-origin is sealed until the red box (47,29) is shoved
  // one tile right, opening the path down; Red then crosses the gate Blue
  // opened, and Green goes up past the blue gate at (17,23). Plates: Yellow
  // (15,29), Blue (46,39), Red (62,29), Green (17,50).
  1013: [
    { box: 11151266, to: { x: 15, y: 29 } }, // → yellow plate
    { box: 11151268, to: { x: 48, y: 29 } }, // shove 1 right → clears the path down to the blue box
    { box: 11151267, to: { x: 46, y: 39 } }, // → blue plate
    { box: 11151268, to: { x: 62, y: 29 } }, // → red plate, over the now-open blue gate
    { box: 11717524, to: { x: 17, y: 50 } }, // → green plate
  ],
};

export function puzzleRecipe(zoneId) {
  return PUZZLE_RECIPES[zoneId] || null;
}
