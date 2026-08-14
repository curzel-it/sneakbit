// What is actually printed on the controller in the player's hands.
//
// Standard Mapping fixes what every button INDEX means — 0 is the bottom
// face button, 4 is the left shoulder — and says nothing at all about what
// the hardware calls them. Those are different questions, and this game
// used to answer both with the Xbox names.
//
// That is not a cosmetic problem on a Nintendo pad. Index 0 is the bottom
// face button, and on a Switch Pro Controller the bottom face button is the
// one with a B on it — Nintendo's A and B are mirrored against everybody
// else's. So "Press A to talk" was pointing at the wrong button on real
// hardware, and following it did the wrong thing. Sony's pads are a milder
// version of the same: index 2 is not X, it's the square.
//
// So: gamepadBindings.js owns which ACTION is on which index, and this file
// owns what that index is CALLED. One is the player's to change, the other
// is the manufacturer's.
//
// Words, not pictures. Prompts are DOM text, and a shape glyph that lands
// on a tofu box is worse than the word — so the Sony face buttons are
// spelled out. Real icons want an image pipeline (or the Steam Input API)
// and are a later job; only this file changes when that source arrives.

export const PAD_XBOX = "xbox";
export const PAD_PLAYSTATION = "playstation";
export const PAD_NINTENDO = "nintendo";

// Xbox is the default for the same reason Standard Mapping is called that:
// it IS the standard layout, and an unrecognised pad claiming to speak it
// is claiming to be one of these.
const NAMES = {
  [PAD_XBOX]: [
    "A", "B", "X", "Y", "LB", "RB", "LT", "RT",
    "Back", "Start", "LS", "RS", "D-Up", "D-Down", "D-Left", "D-Right", "Guide",
  ],
  // The face buttons are shapes, spelled. "Cross" rather than "X": on this
  // pad X is not a button, it's a picture of one, and printing "X" beside a
  // square is the exact confusion this file exists to stop.
  [PAD_PLAYSTATION]: [
    "Cross", "Circle", "Square", "Triangle", "L1", "R1", "L2", "R2",
    "Share", "Options", "L3", "R3", "D-Up", "D-Down", "D-Left", "D-Right", "PS",
  ],
  // A and B swapped, and X and Y with them, which is the whole reason this
  // table isn't a nicety. Index 0 is the bottom face button everywhere; on
  // this hardware the bottom one says B.
  [PAD_NINTENDO]: [
    "B", "A", "Y", "X", "L", "R", "ZL", "ZR",
    "Minus", "Plus", "LS", "RS", "D-Up", "D-Down", "D-Left", "D-Right", "Home",
  ],
};

// USB vendor ids — the one part of a Gamepad.id string that isn't a
// marketing decision. Chrome writes "(STANDARD GAMEPAD Vendor: 054c
// Product: 09cc)" and Firefox writes "054c-09cc-Wireless Controller"; both
// carry the number, and neither agrees with the other about anything else.
const VENDORS = {
  "045e": PAD_XBOX,        // Microsoft
  "054c": PAD_PLAYSTATION, // Sony
  "057e": PAD_NINTENDO,    // Nintendo
  "28de": PAD_XBOX,        // Valve — Steam Input presents a virtual pad in the Xbox layout
};

// Names to fall back on, because a pad reached through a third-party driver
// or an emulated one often has no vendor id in its string at all. Checked
// in order, first hit wins — so anything that could match twice has to be
// ordered deliberately ("dualshock" before "shock", and so on).
const KEYWORDS = [
  [PAD_PLAYSTATION, ["dualsense", "dualshock", "playstation", "ps3", "ps4", "ps5", "sony"]],
  [PAD_NINTENDO, ["nintendo", "switch", "joy-con", "joycon", "pro controller", "wii"]],
  [PAD_XBOX, ["xbox", "xinput", "microsoft"]],
];

// Which family of hardware this is, from the only thing a browser will say
// about it. A guess, and deliberately a cheap one: getting it wrong prints
// the wrong word beside one button, and refusing to guess prints the wrong
// word for every Sony and Nintendo pad there is. Unknown is Xbox, which is
// what the layout is.
export function padKind(id) {
  const said = typeof id === "string" ? id.toLowerCase() : "";
  if (!said) return PAD_XBOX;

  // The vendor id first — it's the half that can't be a marketing decision.
  const vendor = said.match(/vendor:?\s*([0-9a-f]{4})/) || said.match(/^([0-9a-f]{4})-/);
  if (vendor && VENDORS[vendor[1]]) return VENDORS[vendor[1]];

  for (const [kind, words] of KEYWORDS) {
    for (const word of words) if (said.includes(word)) return kind;
  }
  return PAD_XBOX;
}

// What to call button `button` on a pad of that kind. A button outside
// Standard Mapping's seventeen is still named — some pads report twenty —
// because a row saying nothing is a row a player can't rebind their way
// out of.
export function padLabel(button, kind = PAD_XBOX) {
  if (!Number.isInteger(button) || button < 0) return "—";
  return (NAMES[kind] || NAMES[PAD_XBOX])[button] || `Button ${button}`;
}
