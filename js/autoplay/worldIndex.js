// World discovery: which zones exist, found by following teleporter
// destinations from the starting zone. The game has no zone manifest —
// the world graph is implicit in the data, exactly like the engine
// discovers it at play time.
//
// Works on RAW zone JSON (pre-buildZone), so destinations still use the
// upstream field name `world` (zone.js::cloneEntity renames it to `zone`
// for runtime entities). The loader is injected: node wraps readFileSync
// (tools/autoplayWorld.mjs), the browser bot will pass a prefetched Map.

const TELEPORTER_SPECIES_ID = 1019;

// BFS over teleporter destinations starting from `startId`. Locked and
// Permanent teleporters are followed too — a one-way door still proves
// the zone on the other side exists; traversability is the zone graph's
// concern, not discovery's.
//
// Returns:
//   zones: Map<id, rawZoneJson> in discovery order
//   order: zone ids, same order
//   missingDestinations: [{ from, to }] for destinations whose zone file
//     the loader couldn't produce (should be empty on healthy data)
export function discoverWorld(loadRawZone, startId = 1001) {
  const zones = new Map();
  const missingDestinations = [];
  const queue = [startId];
  const seen = new Set(queue);

  while (queue.length) {
    const id = queue.shift();
    const raw = loadRawZone(id);
    if (!raw) {
      missingDestinations.push({ from: null, to: id });
      continue;
    }
    zones.set(id, raw);
    for (const dest of zoneDestinations(raw)) {
      if (seen.has(dest)) continue;
      seen.add(dest);
      // Validate lazily on dequeue, but keep the source zone for the
      // report when the file turns out to be missing.
      const exists = loadRawZone(dest) != null;
      if (!exists) {
        missingDestinations.push({ from: id, to: dest });
        continue;
      }
      queue.push(dest);
    }
  }
  return { zones, order: [...zones.keys()], missingDestinations };
}

// Destination zone ids reachable from a raw zone's teleporters,
// deduplicated, in entity order.
export function zoneDestinations(raw) {
  const out = [];
  const seen = new Set();
  for (const e of raw.entities ?? []) {
    if (e.species_id !== TELEPORTER_SPECIES_ID) continue;
    const dest = e.destination?.world ?? e.destination?.zone;
    if (!dest || seen.has(dest)) continue;
    seen.add(dest);
    out.push(dest);
  }
  return out;
}
