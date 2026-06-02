// Inline rich-text for dialogue lines. Pure (no DOM) so it's unit-testable
// and reusable by the network mirror.
//
// Supported markers, authored directly in the string data:
//   *bold*    -> <strong>
//   _italic_  -> <em>
//
// Parsing follows markdown "flanking" rules so the markers don't collide
// with content already in the data files:
//   - A marker only OPENS when immediately followed by a non-space, so the
//     bullet lists ("* item\n* item") stay literal.
//   - A marker only CLOSES when immediately preceded by a non-space.
//   - "_" additionally refuses to open/close inside a word, so placeholders
//     like %PLAYER_NAME% keep their underscore.
// Emphasis does not nest (the data never nests it); an unmatched marker is
// rendered literally. Implemented as a hand-rolled scanner rather than regex
// lookbehind, which Safari only gained in 16.4.

function isSpace(c) { return c === undefined || c === " " || c === "\t" || c === "\n" || c === "\r"; }
function isWord(c) { return c !== undefined && /[A-Za-z0-9]/.test(c); }

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Turn a leading "* " on any line into a real bullet so the PvP/info lists
// read as lists instead of stray asterisks. Emphasis ("*word*") is never
// followed by a space, so this can't touch it.
export function formatBullets(line) {
  return String(line).replace(/^\* /gm, "• ");
}

// Parse a line into [{ text, bold, italic }] segments. `text` is raw
// (unescaped) — escape at render time.
export function parseRichText(line) {
  const s = String(line);
  const segs = [];
  let i = 0;
  let plainStart = 0;
  const pushPlain = (end) => {
    if (end > plainStart) segs.push({ text: s.slice(plainStart, end), bold: false, italic: false });
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "*" || c === "_") {
      const next = s[i + 1];
      const prev = s[i - 1];
      const canOpen = !isSpace(next) && (c === "*" || !isWord(prev));
      if (canOpen) {
        let j = i + 1;
        let close = -1;
        while (j < s.length) {
          if (s[j] === c && !isSpace(s[j - 1]) && (c === "*" || !isWord(s[j + 1]))) {
            close = j;
            break;
          }
          j++;
        }
        if (close !== -1) {
          pushPlain(i);
          segs.push({ text: s.slice(i + 1, close), bold: c === "*", italic: c === "_" });
          i = close + 1;
          plainStart = i;
          continue;
        }
      }
    }
    i++;
  }
  pushPlain(s.length);
  return segs;
}

export function richTextLength(segs) {
  let n = 0;
  for (const seg of segs) n += seg.text.length;
  return n;
}

// Render segments to HTML, revealing only the first `visible` plaintext
// characters (the rest stay hidden — used by the typewriter). Pass Infinity
// for the whole line.
export function richTextToHtml(segs, visible = Infinity) {
  let remaining = visible;
  let out = "";
  for (const seg of segs) {
    if (remaining <= 0) break;
    const slice = seg.text.length <= remaining ? seg.text : seg.text.slice(0, remaining);
    remaining -= slice.length;
    let piece = escapeHtml(slice);
    if (seg.italic) piece = `<em>${piece}</em>`;
    if (seg.bold) piece = `<strong>${piece}</strong>`;
    out += piece;
  }
  return out;
}

// Convenience: full HTML for a line (bullets + markers), no typewriter.
export function richLineToHtml(line) {
  return richTextToHtml(parseRichText(formatBullets(line)));
}
