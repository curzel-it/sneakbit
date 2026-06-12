// Dialogue exhaustion simulation: what happens if the player keeps
// talking to an entity (or a whole set of entities) until nothing new
// comes out. Built ON the real engine pieces — resolveEntityDialogue
// picks the line, handleReward writes the answer flag and grants the
// one-shot reward — so the sim can never drift from play semantics.
//
// "Exhausted" for one entity = the line that resolves has already been
// read (its dialogue.answer flag is 1): talking again would only repeat.
// An after_dialogue behavior other than "Nothing" removes the entity
// after its first close (interact.js runs handleAfterDialogue on every
// close), persisting `item_collected.<id>` like afterDialogue.js does.

import { resolveEntityDialogue, handleReward } from "../dialogue.js";
import { shouldBeVisible } from "../entityVisibility.js";
import { getValue, setValue } from "../storage.js";

const MAX_TALKS_PER_ENTITY = 200; // backstop; real chains are short

// Talk to one entity until exhausted or removed.
// opts.ephemeralZone: removals don't persist (zone.ephemeralState).
// Returns { linesRead: [text...], removed: bool }.
export function exhaustEntityDialogue(entity, opts = {}) {
  const linesRead = [];
  for (let i = 0; i < MAX_TALKS_PER_ENTITY; i++) {
    if (!shouldBeVisible(entity)) break;
    const d = resolveEntityDialogue(entity);
    if (!d) break;
    const alreadyRead = getValue(`dialogue.answer.${d.text}`) === 1;
    if (alreadyRead) break;
    handleReward(d, 0);
    linesRead.push(d.text);
    if (entity.after_dialogue && entity.after_dialogue !== "Nothing") {
      if (entity.id != null && !opts.ephemeralZone) {
        setValue(`item_collected.${entity.id}`, 1);
      }
      return { linesRead, removed: true };
    }
  }
  return { linesRead, removed: false };
}

// Fixed-point exhaustion over a set of entities: keep cycling until a
// full pass reads nothing new (flags only accumulate, so this
// terminates). `isReachable(entity)` optionally gates who can be talked
// to — the route planner passes a live adjacency check; data-level
// analysis omits it ("can the flag-space reach this line at all").
// Returns { linesRead: Set<text>, removedEntityIds: Set, talks: number }.
export function exhaustDialogues(entities, opts = {}) {
  const isReachable = opts.isReachable ?? (() => true);
  const linesRead = new Set();
  const removedEntityIds = new Set();
  let talks = 0;

  let progress = true;
  while (progress) {
    progress = false;
    for (const e of entities) {
      if (e.id != null && removedEntityIds.has(e.id)) continue;
      if (!isReachable(e)) continue;
      const r = exhaustEntityDialogue(e, opts);
      talks += r.linesRead.length;
      for (const text of r.linesRead) {
        if (!linesRead.has(text)) {
          linesRead.add(text);
          progress = true;
        }
      }
      if (r.removed && e.id != null) removedEntityIds.add(e.id);
    }
  }
  return { linesRead, removedEntityIds, talks };
}
