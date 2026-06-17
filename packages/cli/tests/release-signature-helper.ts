import { createPrivateKey, sign } from "node:crypto";
import type { ReleaseSignatureResponse } from "../src/registry.js";
import {
  type ReleaseSignaturePlatform,
  releaseSignaturePayload,
} from "../src/release-signature.js";

export const testReleaseSignatureKeyId = "opendock-test-2026-01";
export const testReleaseSignaturePrivateKeyBase64 =
  "MC4CAQAwBQYDK2VwBCIEIDwzr4RZV26vCvzbJIzh58no4fPYis1vqujUDHsGrELR";
export const testReleaseSignaturePublicKeyBase64 =
  "MCowBQYDK2VwAyEAPgcscfvGY9zIgPXwOeboEKWoLgEJp/F18y4yD0NsxYw=";

process.env.OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_ID = testReleaseSignatureKeyId;
process.env.OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_BASE64 = testReleaseSignaturePublicKeyBase64;

const testPrivateKey = createPrivateKey({
  key: Buffer.from(testReleaseSignaturePrivateKeyBase64, "base64"),
  format: "der",
  type: "pkcs8",
});

export function testReleaseSignature(subject: {
  id: string;
  version: string;
  platform: ReleaseSignaturePlatform;
  checksum: string;
}): ReleaseSignatureResponse {
  return {
    algorithm: "ed25519",
    keyId: testReleaseSignatureKeyId,
    value: sign(
      null,
      Buffer.from(releaseSignaturePayload(subject), "utf8"),
      testPrivateKey,
    ).toString("base64"),
  };
}
