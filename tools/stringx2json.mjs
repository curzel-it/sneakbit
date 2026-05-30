// Convert the original Rust build's `.stringx` localization files into the
// flat key→string JSON the web port consumes (data/strings.<lang>.json).
//
// This is a faithful port of game_core/src/lang/localizable.rs's parser:
// single-line `"key" = "value"` (with \n \t \\ \" escapes) and triple-quoted
// `"key" = """ ... """` multiline blocks (leading newline after the opening
// quotes and a single trailing newline before the closing quotes are
// stripped). We deliberately do NOT apply the Rust `cleaned()` pass
// (… → ..., ’ → ', — → -) so the JSON keeps the original typography that
// data/strings.en.json already shipped with.
//
// Usage: node tools/stringx2json.mjs <in.stringx> <out.json>

import { readFileSync, writeFileSync } from "node:fs";

function parseStringx(content) {
  const chars = [...content];
  const len = chars.length;
  const out = {};
  let pos = 0;

  const skipWs = () => { while (pos < len && /\s/.test(chars[pos])) pos++; };

  const parseString = () => {
    if (chars[pos] !== '"') throw new Error(`Expected '"' at ${pos}`);
    pos++;
    let result = "";
    while (pos < len) {
      const c = chars[pos];
      if (c === '"') { pos++; return result; }
      if (c === "\\") {
        pos++;
        const e = chars[pos];
        result += e === "n" ? "\n" : e === "t" ? "\t" : e;
      } else {
        result += c;
      }
      pos++;
    }
    throw new Error(`Unterminated string at ${pos}`);
  };

  const parseMultiline = () => {
    pos += 3; // opening """
    if (chars[pos] === "\n") pos++;
    let result = "";
    while (pos + 2 < len) {
      if (chars[pos] === '"' && chars[pos + 1] === '"' && chars[pos + 2] === '"') {
        pos += 3;
        if (result.endsWith("\n")) result = result.slice(0, -1);
        return result;
      }
      result += chars[pos];
      pos++;
    }
    throw new Error(`Unterminated multiline string at ${pos}`);
  };

  while (pos < len) {
    skipWs();
    if (pos >= len) break;
    if (chars[pos] !== '"') throw new Error(`Expected key '"' at ${pos}`);
    const key = parseString();
    skipWs();
    if (chars[pos] !== "=") throw new Error(`Expected '=' after key at ${pos}`);
    pos++;
    skipWs();
    const value = (chars[pos] === '"' && chars[pos + 1] === '"' && chars[pos + 2] === '"')
      ? parseMultiline()
      : parseString();
    out[key] = value;
  }
  return out;
}

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("Usage: node tools/stringx2json.mjs <in.stringx> <out.json>");
  process.exit(1);
}

const parsed = parseStringx(readFileSync(inPath, "utf8"));
// Sort keys so diffs stay stable across regenerations.
const sorted = {};
for (const k of Object.keys(parsed).sort()) sorted[k] = parsed[k];
writeFileSync(outPath, JSON.stringify(sorted, null, 2) + "\n");
console.log(`Wrote ${Object.keys(sorted).length} keys to ${outPath}`);
