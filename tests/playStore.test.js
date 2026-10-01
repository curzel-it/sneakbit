import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import { serviceAccountAssertion, signingEnvironment, trackRelease } from "../tools/playStore.mjs";

test("Gradle signs the bundle with the keystore from .env", () => {
  const signing = signingEnvironment({
    ANDROID_KEYSTORE_PATH: "~/release.keystore",
    ANDROID_KEYSTORE_PASSWORD: "store-secret",
    ANDROID_KEY_ALIAS: "key0",
    ANDROID_KEY_PASSWORD: "key-secret",
  });
  assert.deepEqual(signing, {
    "ORG_GRADLE_PROJECT_android.injected.signing.store.file": join(homedir(), "release.keystore"),
    "ORG_GRADLE_PROJECT_android.injected.signing.store.password": "store-secret",
    "ORG_GRADLE_PROJECT_android.injected.signing.key.alias": "key0",
    "ORG_GRADLE_PROJECT_android.injected.signing.key.password": "key-secret",
  });
});

test("the service account assertion is an RS256 token for the publishing API", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = {
    client_email: "release@sneakbit.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    private_key_id: "abc123",
  };
  const [header, claims, signature] = serviceAccountAssertion(account, 1_700_000_000_000).split(".");
  const verified = createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, signature, "base64url");
  assert.ok(verified);
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT", kid: "abc123" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: 1_700_000_000,
    exp: 1_700_003_600,
  });
});

test("a release puts exactly the new version code on the internal track", () => {
  assert.deepEqual(trackRelease(76, "2.0.0", "completed"), {
    track: "internal",
    releases: [{ name: "76 (2.0.0)", versionCodes: ["76"], status: "completed" }],
  });
});
