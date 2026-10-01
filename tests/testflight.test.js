import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { appStoreToken, archiveArguments, exportArguments } from "../tools/testflight.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = {
  XCODE_ARCHIVES: "/archives",
  EXPORT_OPTIONS: "/keys/ExportOptions.plist",
  ASC_KEY_PATH: "/keys/AuthKey.p8",
  ASC_KEY_ID: "key",
  ASC_ISSUER_ID: "issuer",
};

test("the archive targets the bumped build of SneakBit and signs with the API key", () => {
  const { archive, args } = archiveArguments(ENV, 76);
  assert.equal(archive, "/archives/SneakBit-76.xcarchive");
  assert.deepEqual(args.slice(0, 7), ["archive", "-project", join(ROOT, "ios/SneakBit.xcodeproj"), "-scheme", "SneakBit", "-configuration", "Release"]);
  assert.equal(args[args.indexOf("-archivePath") + 1], archive);
  assert.ok(args.includes("-allowProvisioningUpdates"));
  assert.equal(args[args.indexOf("-authenticationKeyPath") + 1], ENV.ASC_KEY_PATH);
  assert.equal(args[args.indexOf("-authenticationKeyID") + 1], "key");
  assert.equal(args[args.indexOf("-authenticationKeyIssuerID") + 1], "issuer");
});

test("the export uploads that archive with the shared export options", () => {
  const args = exportArguments(ENV, "/archives/SneakBit-76.xcarchive", "/tmp/out");
  assert.deepEqual(args.slice(0, 7), ["-exportArchive", "-archivePath", "/archives/SneakBit-76.xcarchive", "-exportOptionsPlist", ENV.EXPORT_OPTIONS, "-exportPath", "/tmp/out"]);
  assert.ok(args.includes("-allowProvisioningUpdates"));
  assert.ok(args.includes(ENV.ASC_KEY_PATH));
});

test("the App Store Connect token is an ES256 JWT that lives twenty minutes", () => {
  const dir = mkdtempSync(join(tmpdir(), "sneakbit-testflight-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const keyPath = join(dir, "AuthKey.p8");
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
    const [header, claims, signature] = appStoreToken({ ...ENV, ASC_KEY_PATH: keyPath }, 1_700_000_000_000).split(".");
    const verified = createVerify("sha256").update(`${header}.${claims}`).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, signature, "base64url");
    assert.ok(verified);
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "ES256", kid: "key", typ: "JWT" });
    assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), {
      iss: "issuer",
      iat: 1_700_000_000,
      exp: 1_700_001_200,
      aud: "appstoreconnect-v1",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
