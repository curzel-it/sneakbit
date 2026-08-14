// The Linux depot's launch target comes from a dependency now, which means it can go missing in a
// way a code review never sees: a bad install, a renamed file upstream, a `files` pattern that
// packs it somewhere it should not be. electron-builder does not fail a build over an `extraFiles`
// entry it cannot find, and the result is a depot whose launch option points at nothing — the same
// no-window, no-error failure the launcher exists to prevent (docs/linux-steam-sandbox.md).
//
// The launcher's own behaviour is tested in @curzel-it/steam-tools, against a stub binary. What is
// checked here is only what this repo decides: that the thing is wired up.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

test("the linux depot ships a launcher, and it is a launcher", () => {
  const extra = pkg.build.linux.extraFiles;
  assert.equal(extra.length, 1, "one extraFiles entry: the launch target");

  const source = join(ROOT, extra[0].from);
  const script = readFileSync(source, "utf8");
  assert.ok(script.startsWith("#!/bin/sh"), "it is a POSIX shell script");
  assert.ok(script.includes("--no-sandbox"), "and it can give up the sandbox when nothing else works");
  // SteamPipe preserves the exec bit and electron-builder copies it, but nothing puts it back.
  assert.ok(statSync(source).mode & 0o111, "shipped executable");
});

test("the launcher does not land on the binary it wraps", () => {
  // It ships as `sneakbit` — the name Steamworks' launch option already points at — while the
  // Electron binary is `sneakbit-bin`. Collapsing those two names is a script that exec's itself.
  assert.equal(pkg.build.linux.extraFiles[0].to, "sneakbit");
  assert.equal(pkg.build.linux.executableName, "sneakbit-bin");
  assert.notEqual(pkg.build.linux.extraFiles[0].to, pkg.build.linux.executableName);
});

test("the upload knows which app and depots it is going to", () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, "steam.config.json"), "utf8"));
  assert.match(cfg.appId, /^\d+$/);
  for (const platform of ["win", "mac", "linux"]) {
    assert.match(cfg.depots[platform], /^\d+$/, `${platform} depot is an id`);
  }
  // Four distinct numbers. A depot id pasted twice uploads one platform's content over another's.
  const ids = [cfg.appId, ...Object.values(cfg.depots)];
  assert.equal(new Set(ids).size, ids.length, "no id appears twice");
  // The mac depot is arm64-only (docs/steam.md), and the folder the uploader looks for follows it.
  assert.equal(cfg.macArch, pkg.build.mac.target[0].arch[0]);
});

test("the steam config does not ship as a runtime asset", () => {
  // tools/build.mjs copies every root entry into _site/ that is not denied by name, which is
  // deliberate — a new asset ships without editing the build. A packaging file at the root is
  // the other side of that: it went to the public site AND into app.asar, where it made the
  // three platforms' archives differ by whenever each was last built.
  const build = readFileSync(join(ROOT, "tools", "build.mjs"), "utf8");
  assert.ok(build.includes('"steam.config.json"'), "build.mjs denies it by name");
});
