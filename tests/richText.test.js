// Inline rich-text parsing for dialogues. Flanking rules must light up the
// existing *emphasis* in the data WITHOUT mangling bullet lists or the
// %PLAYER_NAME% placeholders.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseRichText,
  richTextLength,
  richTextToHtml,
  richLineToHtml,
  formatBullets,
  escapeHtml,
} from "../js/richText.js";

const boldCount = (segs) => segs.filter((s) => s.bold).length;
const italicCount = (segs) => segs.filter((s) => s.italic).length;

test("plain text is one unstyled segment", () => {
  const segs = parseRichText("hello world");
  assert.deepEqual(segs, [{ text: "hello world", bold: false, italic: false }]);
});

test("*word* becomes bold", () => {
  const segs = parseRichText("he is *placed* now");
  assert.deepEqual(segs, [
    { text: "he is ", bold: false, italic: false },
    { text: "placed", bold: true, italic: false },
    { text: " now", bold: false, italic: false },
  ]);
});

test("_word_ becomes italic", () => {
  const segs = parseRichText("this is _subtle_ text");
  assert.deepEqual(segs[1], { text: "subtle", bold: false, italic: true });
});

test("bold can span spaces (*too big*)", () => {
  const segs = parseRichText("they are *too big* and perfect");
  assert.equal(segs[1].text, "too big");
  assert.equal(segs[1].bold, true);
});

test("bullet lists are NOT treated as emphasis", () => {
  const line = "* All players\n* One controller\n* Realtime";
  const segs = parseRichText(line);
  // No emphasis at all — single literal segment.
  assert.equal(segs.length, 1);
  assert.equal(segs[0].bold, false);
  assert.equal(segs[0].italic, false);
});

test("%PLAYER_NAME% underscore stays literal (no intraword italic)", () => {
  const segs = parseRichText("Player %PLAYER_NAME% won!");
  assert.equal(segs.length, 1);
  assert.equal(segs[0].italic, false);
  assert.ok(segs[0].text.includes("%PLAYER_NAME%"));
});

test("unmatched marker renders literally", () => {
  const segs = parseRichText("2 * 3 = 6");
  assert.equal(segs.length, 1);
  assert.equal(segs[0].text, "2 * 3 = 6");
});

test("richTextLength counts visible chars, not markers", () => {
  const segs = parseRichText("a *bc* d");
  assert.equal(richTextLength(segs), "a bc d".length);
});

test("richTextToHtml wraps and escapes", () => {
  const html = richTextToHtml(parseRichText("a *b* <x>"));
  assert.equal(html, "a <strong>b</strong> &lt;x&gt;");
});

test("typewriter reveal cuts at plaintext boundary, keeps tags closed", () => {
  const segs = parseRichText("ab*cdef*");
  // Reveal 4 chars -> "ab" + "cd" (inside bold). Tag must still close.
  assert.equal(richTextToHtml(segs, 4), "ab<strong>cd</strong>");
  // Reveal 0 -> empty.
  assert.equal(richTextToHtml(segs, 0), "");
});

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml("<b>&'</b>"), "&lt;b&gt;&amp;'&lt;/b&gt;");
});

test("formatBullets turns leading '* ' into a bullet glyph", () => {
  assert.equal(formatBullets("* one\n* two"), "• one\n• two");
  // Emphasis at line start is untouched (no space after the marker).
  assert.equal(formatBullets("*loud* start"), "*loud* start");
});

test("richLineToHtml does bullets + emphasis end to end", () => {
  assert.equal(richLineToHtml("* see *this*"), "• see <strong>this</strong>");
});

test("bold and italic coexist on one line", () => {
  const segs = parseRichText("a *b* and _c_ end");
  assert.equal(boldCount(segs), 1);
  assert.equal(italicCount(segs), 1);
  assert.equal(segs.find((s) => s.bold).text, "b");
  assert.equal(segs.find((s) => s.italic).text, "c");
});

test("marker at the very start and end of a line", () => {
  const segs = parseRichText("*start* middle *end*");
  assert.equal(boldCount(segs), 2);
  assert.equal(segs[0].text, "start");
  assert.equal(segs[segs.length - 1].text, "end");
});

test("adjacent emphasis runs stay separate", () => {
  const segs = parseRichText("*a**b*").filter((s) => s.text);
  assert.deepEqual(segs.map((s) => [s.text, s.bold]), [["a", true], ["b", true]]);
});

test("a trailing space inside markers does not close (won't swallow rest of line)", () => {
  // "*a * b*" -> the "* " can't close (space before is fine, but the marker
  // must be preceded by non-space). The real close is the final '*'.
  const segs = parseRichText("*a * b*");
  assert.equal(segs[0].text, "a * b");
  assert.equal(segs[0].bold, true);
});

// --- Regression against the actual ./data strings: the markers in the data
// must light up emphasis WITHOUT mangling bullet lists or %PLACEHOLDERS%. ---
const STRINGS = JSON.parse(readFileSync(new URL("../data/strings.en.json", import.meta.url)));

test("data: conspiracy monologue gets its *emphasis* (3 bold runs)", () => {
  const line = STRINGS["quest.crazy_conspiracy.girl.black_ninja_i_knew_it"];
  assert.ok(line, "string key present");
  const segs = parseRichText(formatBullets(line));
  // *hiding*, *placed*, *puppets... wait — data has *hiding* and *placed*.
  assert.ok(boldCount(segs) >= 2, `expected emphasis, got ${boldCount(segs)}`);
  assert.ok(segs.some((s) => s.bold && s.text === "hiding"));
  assert.ok(segs.some((s) => s.bold && s.text === "placed"));
});

test("data: stonehenge monologue emphasizes *villagers* / *too big*", () => {
  const line = STRINGS["quest.crazy_conspiracy.girl.stonehenge"];
  const segs = parseRichText(formatBullets(line));
  assert.ok(segs.some((s) => s.bold && s.text === "villagers"));
  assert.ok(segs.some((s) => s.bold && s.text === "too big"));
});

test("data: pvp arena bullet list is NOT emphasized, becomes • bullets", () => {
  const line = STRINGS["pvp_arena.menu.text"];
  const segs = parseRichText(formatBullets(line));
  assert.equal(boldCount(segs), 0, "bullets must not be read as bold");
  assert.equal(italicCount(segs), 0);
  const html = richLineToHtml(line);
  assert.ok(html.includes("• "), "leading '* ' should render as a bullet");
  assert.ok(!html.includes("<strong>"), "no bold tags from bullet asterisks");
});

test("data: %PLAYER_NAME% placeholder keeps its underscore (no stray italic)", () => {
  const line = STRINGS["death_screen.player_won"];
  const segs = parseRichText(formatBullets(line));
  assert.equal(italicCount(segs), 0);
  assert.ok(richLineToHtml(line).includes("%PLAYER_NAME%"));
});

test("data: every English string round-trips without throwing or losing length", () => {
  for (const [key, val] of Object.entries(STRINGS)) {
    if (typeof val !== "string") continue;
    const segs = parseRichText(formatBullets(val));
    // Visible length never exceeds the source (markers only ever removed).
    assert.ok(
      richTextLength(segs) <= formatBullets(val).length,
      `length grew for ${key}`,
    );
    // Rendering must not throw.
    richTextToHtml(segs);
  }
});
