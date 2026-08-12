// Slot → hero lookup against the local world state.
//
// A "slot" is the 1-based seat number: 1 is the host / single player, 2 is
// state.player2 (local co-op P2, or the online guest holding that seat) and
// 3-4 live in state.players[] tagged with their own `slot`.
//
// Every "act for slot N" entry point needs this same lookup — a second
// physical pad (main.js wires slots 2-4 through gamepad callbacks) and a
// forwarded guest intent (hostGuests.dispatchActionForSlot) both land here.
// It used to be copy-pasted into shooting / melee / interact, where the
// copies additionally required state.player2 to carry a playerId. That gate
// only ever mattered for the network path, but it also silently disabled a
// local co-op P2's controller: their shoot / melee / interact buttons
// resolved to nobody. Hosting online forces the local player count back to 1
// (main.tagHostPlayerId), so a slot is never claimed by two avatars at once
// and the gate bought nothing.

export function playerForSlot(state, slot) {
  if (!state) return null;
  if (slot === 1) return state.player || null;
  if (slot === 2) return state.player2 || null;
  if (!Array.isArray(state.players)) return null;
  const entry = state.players.find((e) => e.slot === slot);
  return entry ? entry.player : null;
}
