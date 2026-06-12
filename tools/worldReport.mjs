// Human-readable dump of the autoplay world analysis: zone graph,
// per-zone objective counts, key supply, the computed completionist
// route, and anything unreachable. Run with: node tools/worldReport.mjs

import { loadWorldFromDisk } from "./autoplayWorld.mjs";
import { discoverWorld } from "../js/autoplay/worldIndex.js";
import { buildZoneGraph, edgeTraversable } from "../js/autoplay/zoneGraph.js";
import { zoneObjectives } from "../js/autoplay/objectiveCatalog.js";
import { resetSimState, planRoute } from "../js/autoplay/routePlanner.js";
import { _resetStorageForTesting } from "../js/storage.js";

const world = discoverWorld(loadWorldFromDisk().loadRawZone);
const graph = buildZoneGraph(world);

console.log(`=== Zones (${world.order.length} discovered) ===`);
for (const id of world.order) {
  const model = graph.models.get(id);
  const out = graph.edges.filter((e) => e.from === id);
  const links = out.map((e) => `${e.to}${edgeTraversable(e) ? "" : `[${e.lock}]`}`).join(" ");
  console.log(`  ${String(id).padStart(8)}  ${model.cols}x${model.rows}  -> ${links || "(none)"}`);
}

console.log("\n=== Objectives per zone ===");
_resetStorageForTesting();
const counts = { pickup: 0, hint: 0, talk: 0, cutscene: 0, monster: 0 };
for (const id of world.order) {
  const objs = zoneObjectives(graph.models.get(id));
  const byKind = {};
  for (const o of objs) {
    if (o.kind === "exit") continue;
    byKind[o.kind] = (byKind[o.kind] || 0) + 1;
    if (counts[o.kind] !== undefined) counts[o.kind]++;
  }
  const model = graph.models.get(id);
  const puzzle = model.gates.length || model.plates.length || model.pushables.length
    ? `  [gates:${model.gates.length} plates:${model.plates.length} pushables:${model.pushables.length}]`
    : "";
  console.log(`  ${String(id).padStart(8)}  ${JSON.stringify(byKind)}${puzzle}`);
}
console.log(`  totals: ${JSON.stringify(counts)}`);

console.log("\n=== Route ===");
const t0 = process.hrtime.bigint();
resetSimState();
const route = planRoute(world);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

const stepCounts = {};
for (const s of route.steps) stepCounts[s.kind] = (stepCounts[s.kind] || 0) + 1;
console.log(`  planned in ${ms.toFixed(0)}ms`);
console.log(`  steps: ${JSON.stringify(stepCounts)}`);
console.log(`  zones visited: ${route.visitedZones.size}/${world.order.length}`);
console.log(`  dialogue lines read: ${route.linesRead.size}`);
console.log(`  finale reached: ${route.finaleReached}`);

const itinerary = route.steps.filter((s) => s.kind === "travel");
console.log(`\n  itinerary (${itinerary.length} hops):`);
let line = "  1001";
for (const s of itinerary) line += ` -> ${s.to}`;
console.log(wrap(line, 100, "    "));

if (route.keysLedger.length) {
  console.log("\n  key spends:");
  for (const k of route.keysLedger) {
    console.log(`    ${k.color} key on gate ${k.gate} in zone ${k.zone}`);
  }
} else {
  console.log("\n  key spends: none (all gates plate-solvable or open)");
}

if (route.unreachable.length) {
  console.log(`\n=== UNREACHABLE (${route.unreachable.length}) ===`);
  for (const u of route.unreachable) {
    console.log(`  ${u.kind} in zone ${u.zone}: ${u.entityId ?? u.key}`);
  }
} else {
  console.log("\n=== UNREACHABLE: none — world is 100% completable ===");
}

function wrap(text, width, indent) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + w.length + 1 > width) {
      lines.push(cur);
      cur = indent + w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}
