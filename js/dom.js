// Tiny DOM-construction helper. The UI layer is DOM-only (no canvas, per
// CLAUDE.md), so the panels hand-build their markup — and were each growing
// the same createElement / set-className / set-textContent / appendChild
// boilerplate. el() collapses that into one declarative call.
//
//   el("button", { class: "account-primary", text: label, on: { click } })
//   el("div", { class: "row" }, [labelEl, inputEl])
//
// It's the structural sibling of js/uiTokens.js (which centralizes the
// shared styling tokens): a genuine cross-cutting concern, not the fusing
// of two features.
//
// Props:
//   class   -> node.className
//   text    -> node.textContent
//   html    -> node.innerHTML            (escape hatch; trusted strings only)
//   style   -> Object.assign(node.style, value)
//   dataset -> node.dataset[k] = v for each entry (camelCase -> data-kebab)
//   on      -> { click, keydown, ... } addEventListener for each entry
//   <other> -> assigned as a DOM property (id, value, type, disabled,
//              placeholder, title, maxLength, ...). null/undefined skipped.
//
// children: a node, a string/number (becomes a text node), or a (nested)
// array thereof. null / undefined / false entries are skipped, so
// `cond && el(...)` works inline.

export function el(tag, props = {}, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "style") Object.assign(node.style, value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "on") {
      for (const [event, handler] of Object.entries(value)) {
        node.addEventListener(event, handler);
      }
    } else {
      node[key] = value;
    }
  }
  appendChildren(node, children);
  return node;
}

// Show exactly one node from a { key: node } map and hide the rest — the
// "switch to view N" move panels kept hand-rolling as an Object.entries
// loop. `shown` is the display value for the visible node (default
// "block"; pass "flex" etc. when the view is a flex container).
export function showOnly(map, key, shown = "block") {
  for (const [k, node] of Object.entries(map)) {
    if (node) node.style.display = k === key ? shown : "none";
  }
}

function appendChildren(node, children) {
  if (children == null) return;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) { appendChildren(node, child); continue; }
    node.append(typeof child === "number" ? String(child) : child);
  }
}
