import { readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { isOpenDockPlatform } from "./platform.js";

const safeSegmentPattern = /^[A-Za-z0-9._-]+$/;
const versionSelectorPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;

export class DockRef {
  constructor(
    readonly owner: string,
    readonly name: string,
    readonly selector: string,
  ) {}

  static parse(value: string): DockRef {
    const trimmed = value.trim();
    const [namePart = "", selector, extraSelector] = trimmed.split("@");
    if (extraSelector !== undefined) {
      throw new Error("dock reference may contain only one version selector");
    }
    if (selector === undefined) {
      throw new Error(
        "dock reference must include an exact version identifier, e.g. owner/name@1.0.0",
      );
    }
    if (selector.trim() === "") {
      throw new Error("dock version selector cannot be empty");
    }
    if (selector === "latest") {
      throw new Error("dock version selector must be an exact version identifier");
    }
    if (!isSafeVersionSelector(selector)) {
      throw new Error("dock version selector must be an exact version identifier");
    }

    const parts = namePart.split("/");
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

    return new DockRef(owner, name, selector);
  }

  id(): string {
    return `${this.owner}/${this.name}`;
  }

  requested(): string {
    return this.selector;
  }

  toString(): string {
    return `${this.id()}@${this.selector}`;
  }
}

const copySpecSchema = z.object({
  from: z.string(),
  to: z.string(),
});

const fileUpdatePolicySchema = z.enum([
  "append_unique",
  "managed_block",
  "managed_file",
  "manual_review",
]);

const fileSpecSchema = z.object({
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

const interactiveSchema = z.union([
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

const lifecycleStepSchema = lifecycleStepFieldsSchema.extend({
  id: z.string(),
  platforms: lifecyclePlatformsSchema,
});

const lifecycleSchema = z.object({
  install: z.array(lifecycleStepSchema).default([]),
  update: z.array(lifecycleStepSchema).default([]),
  doctor: z.array(lifecycleStepSchema).default([]),
});

const dockManifestSchema = z
  .object({
    opendock: z.number().optional(),
    id: z.string(),
    name: z.string().optional(),
    summary: z.string().default(""),
    readme: z.string().optional(),
    logo: z.string().optional(),
    needs: z.record(z.string(), z.string()).default({}),
    files: z.array(fileSpecSchema).default([]),
    lifecycle: lifecycleSchema.default({ install: [], update: [], doctor: [] }),
  })
  .strict();

export type DockManifest = z.infer<typeof dockManifestSchema>;
export type FileSpec = z.infer<typeof fileSpecSchema>;
export type FileUpdatePolicy = z.infer<typeof fileUpdatePolicySchema>;
export type LifecycleStep = z.infer<typeof lifecycleStepSchema>;
export type LifecyclePhase = keyof z.infer<typeof lifecycleSchema>;

export function parseManifestFile(path: string): DockManifest {
  try {
    return dockManifestSchema.parse(YAML.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`failed to parse ${path}: ${(error as Error).message}`);
  }
}

export function validateManifestFor(manifest: DockManifest, requested: DockRef): void {
  if (manifest.opendock === undefined) {
    throw new Error("manifest must declare `opendock: 1`");
  }
  if (manifest.opendock !== undefined && manifest.opendock !== 1) {
    throw new Error(`unsupported opendock manifest version \`${manifest.opendock}\``);
  }
  if (manifest.id !== requested.id()) {
    throw new Error(
      `manifest id \`${manifest.id}\` does not match requested dock \`${requested}\``,
    );
  }
}

export function assertVersionSatisfiesSelector(version: string, selector: string): void {
  if (versionSatisfiesSelector(version, selector)) {
    return;
  }
  throw new Error(`resolved version ${version} does not satisfy selector ${selector}`);
}

function versionSatisfiesSelector(version: string, selector: string): boolean {
  return version === selector;
}

function isSafeSegment(value: string): boolean {
  if (value === "." || value === ".." || value.includes("..")) {
    return false;
  }
  return safeSegmentPattern.test(value);
}

function isSafeVersionSelector(value: string): boolean {
  return versionSelectorPattern.test(value);
}
