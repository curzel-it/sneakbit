// guardTextInput attaches keydown/keyup listeners that stop a focused field's
// keystrokes from bubbling to the window-level game input handlers. The unit
// suite is pure-node (no DOM), so a tiny fake input — just addEventListener +
// a dispatch helper — lets us assert the contract: non-Escape keys get
// stopPropagation, Escape passes through, and the character is never
// preventDefault'd. The real bubbling is covered by the e2e panels.

import { test } from "node:test";
import assert from "node:assert/strict";
import { guardTextInput } from "../js/textInputGuard.js";

function fakeInput() {
  const listeners = {};
  return {
    listeners,
    addEventListener(event, handler) { (listeners[event] ??= []).push(handler); },
    dispatch(event, key) {
      const e = { key, stopped: false, prevented: false };
      e.stopPropagation = () => { e.stopped = true; };
      e.preventDefault = () => { e.prevented = true; };
      for (const h of listeners[event] ?? []) h(e);
      return e;
    },
  };
}

test("guardTextInput returns the same element", () => {
  const input = fakeInput();
  assert.equal(guardTextInput(input), input);
});

test("guards both keydown and keyup", () => {
  const input = fakeInput();
  guardTextInput(input);
  assert.equal(input.listeners.keydown.length, 1);
  assert.equal(input.listeners.keyup.length, 1);
});

test("non-Escape keys stop propagation but never preventDefault", () => {
  const input = fakeInput();
  guardTextInput(input);
  for (const key of ["w", "a", "s", "d", "f", "g", "e", "Enter", "ArrowUp"]) {
    const down = input.dispatch("keydown", key);
    assert.equal(down.stopped, true, `keydown ${key} should stop propagation`);
    assert.equal(down.prevented, false, `keydown ${key} must not preventDefault`);
    const up = input.dispatch("keyup", key);
    assert.equal(up.stopped, true, `keyup ${key} should stop propagation`);
  }
});

test("Escape is let through so panels can still close", () => {
  const input = fakeInput();
  guardTextInput(input);
  const down = input.dispatch("keydown", "Escape");
  assert.equal(down.stopped, false);
  assert.equal(down.prevented, false);
});
