// First-city arrow hint. A one-shot animated up-arrow (species 6006) placed
// in zone 1002, pointing players toward the first city. It shows the whole
// time the player is in 1002 on their first visit, then is hidden forever:
// the placed entity's display_conditions hide it once `seen.first_city_arrow`
// is set, and we set that flag here the moment the player leaves zone 1002.

import { setValue } from "./storage.js";

const ARROW_ZONE_ID = 1002;

// Storage flag the placed arrow's display_conditions watch (visible:false
// when set). Exported so the value stays defined in one place.
export const FIRST_CITY_ARROW_SEEN_KEY = "seen.first_city_arrow";

// Called from transitions.js when a zone transition begins, with the zone the
// player is leaving. The first time that zone is 1002 we mark the hint seen;
// re-setting on later exits is a harmless no-op.
export function noteZoneExited(sourceZoneId) {
  if (sourceZoneId === ARROW_ZONE_ID) {
    setValue(FIRST_CITY_ARROW_SEEN_KEY, 1);
  }
}
