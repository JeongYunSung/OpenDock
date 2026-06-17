import { createPublicKey, verify } from "node:crypto";
import type { OpenDockPlatform } from "./platform.js";
import type { ReleaseSignatureResponse } from "./registry.js";

const defaultTrustedPublicKeys: Record<string, string> = {
  "opendock-root-2026-01": "MCowBQYDK2VwAyEAXNVc5LvpQBcibQinZSVRcgyq0xZEVuNKwZpuX8Ty8r4=",
  "opendock-root-2026-02": "MCowBQYDK2VwAyEAI1dULjXnP6hY070UjhKf/WNMGQDA500i+f2WC3gwp7g=",
};

export interface ReleaseSignatureSubject {
  id: string;
  version: string;
  platform: ReleaseSignaturePlatform;
  checksum: string;
}

export type ReleaseSignaturePlatform = OpenDockPlatform | "any";

export function releaseSignaturePayload(subject: ReleaseSignatureSubject): string {
  return [
    "opendock-release-v1",
    `id:${subject.id}`,
    `version:${subject.version}`,
    `platform:${subject.platform}`,
    `checksum_sha256:${subject.checksum}`,
    "",
  ].join("\n");
}

export function verifyReleaseSignature(
  subject: ReleaseSignatureSubject,
  signature: ReleaseSignatureResponse,
  trustedPublicKeys = trustedReleasePublicKeys(),
): void {
  if (!isReleaseSignatureValid(subject, signature, trustedPublicKeys)) {
    throw new Error(
      `OpenDock Registry signature verification failed for \`${subject.id}@${subject.version}\``,
    );
  }
}

export function isReleaseSignatureValid(
  subject: ReleaseSignatureSubject,
  signature: ReleaseSignatureResponse,
  trustedPublicKeys = trustedReleasePublicKeys(),
): boolean {
  if (signature.algorithm !== "ed25519") {
    throw new Error(`unsupported OpenDock Registry signature algorithm \`${signature.algorithm}\``);
  }
  if (signature.keyId.trim() === "") {
    throw new Error("OpenDock Registry signature is missing a key id");
  }
  const publicKeyBase64 = trustedPublicKeys[signature.keyId];
  if (publicKeyBase64 === undefined) {
    throw new Error(`untrusted OpenDock Registry signature key \`${signature.keyId}\``);
  }
  const signatureBytes = decodeBase64(signature.value, "OpenDock Registry signature");
  if (signatureBytes.byteLength !== 64) {
    throw new Error("OpenDock Registry signature is not a valid Ed25519 signature");
  }
  const publicKeyBytes = decodeBase64(publicKeyBase64, "OpenDock Registry public key");
  const publicKey = createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" });
  return verify(
    null,
    Buffer.from(releaseSignaturePayload(subject), "utf8"),
    publicKey,
    signatureBytes,
  );
}

function trustedReleasePublicKeys(): Record<string, string> {
  const keyId = process.env.OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_ID?.trim();
  const publicKey = process.env.OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_BASE64?.trim();
  if (keyId && publicKey) {
    return { ...defaultTrustedPublicKeys, [keyId]: publicKey };
  }
  return defaultTrustedPublicKeys;
}

function decodeBase64(value: string, label: string): Buffer {
  const normalized = value.trim();
  if (normalized === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`${label} is not valid base64`);
  }
  return Buffer.from(normalized, "base64");
}
