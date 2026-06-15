import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Bytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fileChecksum(path: string): string {
  return sha256Bytes(readFileSync(path));
}

export function textChecksum(text: string): string {
  return sha256Bytes(text);
}
