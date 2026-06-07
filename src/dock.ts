import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";
import { isOpenDockPlatform } from "./platform.js";

const safeSegmentPattern = /^[A-Za-z0-9._-]+$/;

export class DockRef {
  constructor(
    readonly owner: string,
    readonly name: string,
  ) {}

  static parse(value: string): DockRef {
    const trimmed = value.trim();
    const parts = trimmed.split("/");
    if (parts.length !== 2) {
      throw new Error("dock reference must be in owner/name form");
    }

    const [owner, name] = parts;
    if (!owner || owner.trim() === "") {
      throw new Error("dock owner cannot be empty");
    }
    if (!name || name.trim() === "") {
      throw new Error("dock name cannot be empty");
    }
    if (!isSafeSegment(owner) || !isSafeSegment(name)) {
      throw new Error(
        "dock owner/name may only contain ASCII letters, numbers, dots, underscores, and hyphens",
      );
    }

    return new DockRef(owner, name);
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

export const fileUpdatePolicySchema = z.enum(["append_unique", "managed_block", "manual_review"]);

export const fileSpecSchema = z.object({
  from: z.string(),
  to: z.string(),
  update: fileUpdatePolicySchema,
});

const interactiveKeySchema = z.enum([
  "backspace",
  "down",
  "enter",
  "escape",
  "left",
  "right",
  "space",
  "tab",
  "up",
]);

const interactiveInputSchema = z.union([
  z.string(),
  z.object({
    key: interactiveKeySchema,
    repeat: z.number().int().positive().default(1),
  }),
  z.object({
    text: z.string(),
    repeat: z.number().int().positive().default(1),
  }),
]);

export const interactiveSchema = z.union([
  z.literal("user"),
  z.literal("scripted"),
  z.object({
    mode: z.literal("scripted"),
    inputs: z.array(interactiveInputSchema).default([]),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
  }),
]);

const lifecycleStepFieldsSchema = z.object({
  name: z.string().optional(),
  check: z.string().optional(),
  interactive: interactiveSchema.optional(),
  run: z.string().optional(),
  repair: z.string().optional(),
  version: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
  copy: copySpecSchema.optional(),
  messages: z.record(z.string(), z.string()).default({}),
});

const lifecyclePlatformStepSchema = lifecycleStepFieldsSchema;

const lifecyclePlatformsSchema = z
  .record(z.string(), lifecyclePlatformStepSchema)
  .default({})
  .superRefine((platforms, context) => {
    for (const platform of Object.keys(platforms)) {
      if (!isOpenDockPlatform(platform)) {
        context.addIssue({
          code: "custom",
          message: `unsupported platform \`${platform}\``,
          path: [platform],
        });
      }
    }
  });

export const lifecycleStepSchema = lifecycleStepFieldsSchema.extend({
  id: z.string(),
  platforms: lifecyclePlatformsSchema,
});

export const lifecycleSchema = z.object({
  install: z.array(lifecycleStepSchema).default([]),
  update: z.array(lifecycleStepSchema).default([]),
  doctor: z.array(lifecycleStepSchema).default([]),
});

export const dockManifestSchema = z.object({
  opendock: z.number().optional(),
  schema: z.string().optional(),
  kind: z.string().optional(),
  id: z.string(),
  name: z.string().optional(),
  summary: z.string().default(""),
  version: z.string().default("0.1.0"),
  needs: z.record(z.string(), z.string()).default({}),
  files: z.array(fileSpecSchema).default([]),
  lifecycle: lifecycleSchema.default({ install: [], update: [], doctor: [] }),
  setup: z.array(lifecycleStepSchema).default([]),
});

export type DockManifest = z.infer<typeof dockManifestSchema>;
export type FileSpec = z.infer<typeof fileSpecSchema>;
export type LifecycleStep = z.infer<typeof lifecycleStepSchema>;
export type LifecyclePhase = keyof z.infer<typeof lifecycleSchema>;

export function validateManifestFor(manifest: DockManifest, requested: DockRef): void {
  if (manifest.opendock === undefined && manifest.schema === undefined) {
    throw new Error("manifest must declare `opendock` or `schema`");
  }
  if (manifest.opendock !== undefined && manifest.opendock !== 1) {
    throw new Error(`unsupported opendock manifest version \`${manifest.opendock}\``);
  }
  if (manifest.schema !== undefined && manifest.schema !== SCHEMA_VERSION) {
    throw new Error(`unsupported schema \`${manifest.schema}\``);
  }
  if (manifest.kind !== undefined && manifest.kind !== "starterpack") {
    throw new Error(`unsupported kind \`${manifest.kind}\``);
  }
  if (manifest.id !== requested.id()) {
    throw new Error(
      `manifest id \`${manifest.id}\` does not match requested dock \`${requested}\``,
    );
  }
}

function isSafeSegment(value: string): boolean {
  if (value === "." || value === ".." || value.includes("..")) {
    return false;
  }
  return safeSegmentPattern.test(value);
}
