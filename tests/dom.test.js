// el() is a DOM helper, but the unit suite is pure-node (no DOM). A tiny
// fake document — just the surface el() touches — lets us assert the whole
// contract in milliseconds without a browser. The real DOM behavior is
// covered separately by the e2e suite that drives the panels el() builds.

import { test } from "node:test";
import assert from "node:assert/strict";

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.listeners = {};
  }
  addEventListener(event, handler) {
    (this.listeners[event] ??= []).push(handler);
  }
  append(...nodes) {
    for (const n of nodes) this.children.push(n);
  }
  // Test-only: fire every handler registered for an event.
  dispatch(event, arg) {
    for (const h of this.listeners[event] ?? []) h(arg);
  }
}

globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
};

const { el, showOnly } = await import("../js/dom.js");

test("class / text / html map to the right properties", () => {
  const node = el("div", { class: "card", text: "hi" });
  assert.equal(node.tagName, "div");
  assert.equal(node.className, "card");
  assert.equal(node.textContent, "hi");

  const raw = el("p", { html: "<b>x</b>" });
  assert.equal(raw.innerHTML, "<b>x</b>");
});

test("arbitrary keys become DOM properties; null/undefined skipped", () => {
  const input = el("input", {
    id: "code",
    type: "password",
    maxLength: 5,
    disabled: true,
    placeholder: undefined,
    title: null,
  });
  assert.equal(input.id, "code");
  assert.equal(input.type, "password");
  assert.equal(input.maxLength, 5);
  assert.equal(input.disabled, true);
  assert.ok(!("placeholder" in input) || input.placeholder === undefined);
  assert.equal(input.title, undefined);
});

test("style merges into node.style; dataset into node.dataset", () => {
  const node = el("span", {
    style: { display: "none", color: "#eee" },
    dataset: { view: "single", count: "3" },
  });
  assert.deepEqual(node.style, { display: "none", color: "#eee" });
  assert.deepEqual(node.dataset, { view: "single", count: "3" });
});

test("on registers listeners that fire", () => {
  let clicks = 0;
  let lastKey = null;
  const btn = el("button", {
    on: {
      click: () => { clicks++; },
      keydown: (e) => { lastKey = e.key; },
    },
  });
  btn.dispatch("click");
  btn.dispatch("click");
  btn.dispatch("keydown", { key: "Enter" });
  assert.equal(clicks, 2);
  assert.equal(lastKey, "Enter");
});

test("children: node, string, number, nested arrays; null/false skipped", () => {
  const a = el("span");
  const b = el("span");
  const showExtra = false;
  const parent = el("div", {}, [
    a,
    "text",
    42,
    null,
    undefined,
    showExtra && el("span"),
    [b, "nested"],
  ]);
  assert.deepEqual(parent.children, [a, "text", "42", b, "nested"]);
});

test("a single (non-array) child is appended", () => {
  const child = el("span");
  const parent = el("div", {}, child);
  assert.deepEqual(parent.children, [child]);

  const textOnly = el("p", {}, "hello");
  assert.deepEqual(textOnly.children, ["hello"]);
});

test("props default to empty; el(tag) alone works", () => {
  const node = el("hr");
  assert.equal(node.tagName, "hr");
  assert.deepEqual(node.children, []);
});

test("showOnly displays the keyed node and hides the rest", () => {
  const views = { a: el("div"), b: el("div"), c: el("div") };
  showOnly(views, "b");
  assert.equal(views.a.style.display, "none");
  assert.equal(views.b.style.display, "block");
  assert.equal(views.c.style.display, "none");

  // Switching is exclusive — the previously shown node hides again.
  showOnly(views, "a", "flex");
  assert.equal(views.a.style.display, "flex");
  assert.equal(views.b.style.display, "none");
});

test("showOnly tolerates null entries in the map", () => {
  const views = { a: el("div"), b: null };
  assert.doesNotThrow(() => showOnly(views, "a"));
  assert.equal(views.a.style.display, "block");
});
