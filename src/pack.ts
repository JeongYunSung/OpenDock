import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";

const safeSegmentPattern = /^[A-Za-z0-9._-]+$/;

export class PackRef {
  constructor(
    readonly owner: string,
    readonly name: string,
  ) {}

  static parse(value: string): PackRef {
    const trimmed = value.trim();
    const parts = trimmed.split("/");
    if (parts.length !== 2) {
      throw new Error("pack reference must be in owner/name form");
    }

    const [owner, name] = parts;
    if (!owner || owner.trim() === "") {
      throw new Error("pack owner cannot be empty");
    }
    if (!name || name.trim() === "") {
      throw new Error("pack name cannot be empty");
    }
    if (!isSafeSegment(owner) || !isSafeSegment(name)) {
      throw new Error(
        "pack owner/name may only contain ASCII letters, numbers, dots, underscores, and hyphens",
      );
    }

    return new PackRef(owner, name);
  }

  id(): string {
    return `${this.owner}/${this.name}`;
  }

  toString(): string {
    return this.id();
  }
}

export const copySpecSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const setupStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  check: z.string().optional(),
  run: z.string().optional(),
  copy: copySpecSchema.optional(),
  messages: z.record(z.string(), z.string()).default({}),
});

export const packManifestSchema = z.object({
  schema: z.string(),
  kind: z.string(),
  id: z.string(),
  name: z.string(),
  summary: z.string().default(""),
  version: z.string().default("0.1.0"),
  needs: z.record(z.string(), z.string()).default({}),
  setup: z.array(setupStepSchema).default([]),
});

export type PackManifest = z.infer<typeof packManifestSchema>;
export type SetupStep = z.infer<typeof setupStepSchema>;

export function validateManifestFor(manifest: PackManifest, requested: PackRef): void {
  if (manifest.schema !== SCHEMA_VERSION) {
    throw new Error(`unsupported schema \`${manifest.schema}\``);
  }
  if (manifest.kind !== "starterpack") {
    throw new Error(`unsupported kind \`${manifest.kind}\``);
  }
  if (manifest.id !== requested.id()) {
    throw new Error(
      `manifest id \`${manifest.id}\` does not match requested pack \`${requested}\``,
    );
  }
}

function isSafeSegment(value: string): boolean {
  if (value === "." || value === ".." || value.includes("..")) {
    return false;
  }
  return safeSegmentPattern.test(value);
}
