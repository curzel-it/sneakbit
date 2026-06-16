import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpecies, loadStrings } = await import("../js/data.js");

// Minimal Response-ish stub. `jsonThrows` mimics res.json() on an HTML body
// (the SPA fallback a proxy 200s for unknown paths).
function stubFetch({ ok = true, status = 200, json, jsonThrows = false }) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok,
    status,
    json: async () => {
      if (jsonThrows) throw new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`);
      return json;
    },
  });
  return () => { globalThis.fetch = orig; };
}

test("fetchJson rethrows a clear error when a 200 carries non-JSON (HTML fallback)", async () => {
  const restore = stubFetch({ ok: true, status: 200, jsonThrows: true });
  try {
    await assert.rejects(
      // species isn't cached at this point; the bad fetch must surface.
      () => loadSpecies(),
      (err) => {
        assert.match(err.message, /Non-JSON response/);
        assert.doesNotMatch(err.message, /DOCTYPE/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("fetchJson surfaces a status error on a non-OK response", async () => {
  const restore = stubFetch({ ok: false, status: 404 });
  try {
    await assert.rejects(() => loadStrings("zz"), /Failed to load .*: 404/);
  } finally {
    restore();
  }
});
