// Main-thread client for the solver Web Worker. Owns the Worker, hands out
// request ids, and resolves a Promise per solve. esbuild bundles the
// `new Worker(new URL(...))` target as its own worker entry, so this works
// the same loose (dev) and chunked (prod).

import { loadSpecies } from "../data.js";
import { snapshotStorage } from "../storage.js";

export function makeSolver() {
  let worker = null;
  let nextId = 1;
  let speciesSent = false;
  const pending = new Map();

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("./solverWorker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { id, ok, solve, error } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(solve);
      else p.reject(new Error(error || "solve failed"));
    };
    worker.onerror = (e) => {
      // A fatal worker error rejects everything in flight; the bot treats a
      // rejected solve as "unsolvable for now" and moves on.
      for (const [, p] of pending) p.reject(new Error(e.message || "worker error"));
      pending.clear();
    };
    return worker;
  }

  // req: { raw, startTile, goalTiles, pushableStarts:[{id,x,y}], maxStates }
  // Snapshots live storage so the worker sees current progress. Species is
  // sent once (it never changes).
  async function solve(req) {
    const w = ensureWorker();
    const species = speciesSent ? null : await loadSpecies();
    speciesSent = true;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, species, snapshot: snapshotStorage(), ...req });
    });
  }

  function dispose() {
    if (worker) worker.terminate();
    worker = null;
    pending.clear();
  }

  return { solve, dispose };
}
