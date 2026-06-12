// Keep keystrokes typed into a DOM <input> from leaking to the game's keyboard
// handlers. Movement (input.js) and action (shooting / melee / interact / …)
// listeners all live on `window` in the bubble phase, so the keystroke reaches
// them only after bubbling up past the focused field. A field that stops
// propagation of its own key events keeps gameplay keys (WASD, F, G, E …) from
// being swallowed mid-type — while the character still lands in the field (we
// never preventDefault) and the field's own Enter-to-submit handler, on the
// same element, still runs.
//
// Escape is deliberately let through: the account / party panels close on a
// window-level Escape handler, which should keep working while a field is
// focused.

function stopUnlessEscape(e) {
  if (e.key === "Escape") return;
  e.stopPropagation();
}

export function guardTextInput(input) {
  input.addEventListener("keydown", stopUnlessEscape);
  input.addEventListener("keyup", stopUnlessEscape);
  return input;
}
