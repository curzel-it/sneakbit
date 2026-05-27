// Tiny leveled logger. Single-line JSON-ish records to stdout/stderr so
// journalctl / docker-style log shippers can grep them later. The format
// is `<ISO ts> <LEVEL> <event> key=value ...` — not strict JSON because
// systemd-journal already adds a timestamp and the human-readable form
// is faster to eyeball when ssh'd into the box. If we ever switch to a
// log aggregator that wants real JSON, swap the formatter here without
// touching call sites.
//
// LOG_LEVEL=debug|info|warn|error (default: info). Levels below the
// configured threshold are no-ops; the level check happens before
// argument formatting so debug calls stay essentially free in prod.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function parseLevel(raw) {
  if (typeof raw !== "string" || !raw.trim()) return LEVELS.info;
  const v = LEVELS[raw.trim().toLowerCase()];
  return typeof v === "number" ? v : LEVELS.info;
}

function formatFields(fields) {
  if (!fields) return "";
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    let s;
    if (v === null) s = "null";
    else if (typeof v === "string") {
      // Quote strings with whitespace or '='; keep simple tokens bare so
      // grep stays ergonomic.
      s = /[\s="]/.test(v) ? JSON.stringify(v) : v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      s = String(v);
    } else {
      s = JSON.stringify(v);
    }
    parts.push(`${k}=${s}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

export function createLogger({ level, stream } = {}) {
  const threshold = parseLevel(level ?? process.env.LOG_LEVEL);
  const out = stream || ((line, isErr) => {
    if (isErr) process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  });
  function emit(lvl, lvlName, event, fields) {
    if (lvl < threshold) return;
    const line = `${new Date().toISOString()} ${lvlName.toUpperCase()} ${event}${formatFields(fields)}`;
    out(line, lvl >= LEVELS.warn);
  }
  return {
    debug: (event, fields) => emit(LEVELS.debug, "debug", event, fields),
    info:  (event, fields) => emit(LEVELS.info,  "info",  event, fields),
    warn:  (event, fields) => emit(LEVELS.warn,  "warn",  event, fields),
    error: (event, fields) => emit(LEVELS.error, "error", event, fields),
    level: threshold,
  };
}

// Default singleton — most call sites import this directly. Tests that
// want to capture output should use createLogger({ stream }).
export const log = createLogger();
