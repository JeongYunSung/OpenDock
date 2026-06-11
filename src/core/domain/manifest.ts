import { readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { isOpenDockPlatform } from "../../platform.js";

const safeSegmentPattern = /^[A-Za-z0-9._-]+$/;
const versionSelectorPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
const supportedRuntimeNames = new Set([
  "bun",
  "git",
  "node",
  "npm",
  "pip",
  "pip3",
  "python",
  "python3",
]);

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
    if (selector === undefined || selector.trim() === "") {
      throw new Error(
        "dock reference must include an exact version identifier, e.g. owner/name@1.0.0",
      );
    }
    if (selector === "latest" || !versionSelectorPattern.test(selector)) {
      throw new Error("dock version selector must be an exact version identifier");
    }

    const parts = namePart.split("/");
    if (parts.length !== 2) {
      throw new Error("dock reference must be in owner/name form");
    }
    const [owner, name] = parts;
    if (!owner || !name || !safeSegmentPattern.test(owner) || !safeSegmentPattern.test(name)) {
      throw new Error(
        "dock owner/name may only contain ASCII letters, numbers, dots, underscores, and hyphens",
      );
    }
    if (owner.includes("..") || name.includes("..")) {
      throw new Error("dock owner/name may not contain parent path segments");
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

const fileSpecSchema = z.object({
  from: z.string(),
  to: z.string(),
});

const runtimeRequirementsSchema = z
  .record(
    z.string().regex(/^[A-Za-z0-9._-]+$/, "runtime name must be a safe identifier"),
    z.string(),
  )
  .default({})
  .superRefine((runtimes, context) => {
    for (const runtime of Object.keys(runtimes)) {
      if (!supportedRuntimeNames.has(runtime)) {
        context.addIssue({
          code: "custom",
          message: `unsupported required runtime \`${runtime}\``,
          path: [runtime],
        });
      }
    }
  });

const packageRequirementSchema = z
  .object({
    manager: z.enum(["bun", "npm", "pnpm", "pip", "pip3", "pipx", "uv"]),
    name: z
      .string()
      .regex(
        /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/,
        "package name must be a safe package identifier",
      ),
    version: z.string(),
  })
  .strict();

const packageRequirementsSchema = z
  .record(
    z.string().regex(/^[A-Za-z0-9._-]+$/, "package key must be a safe identifier"),
    packageRequirementSchema,
  )
  .default({});

const requiresSchema = z
  .object({
    runtimes: runtimeRequirementsSchema,
    packages: packageRequirementsSchema,
  })
  .default({ runtimes: {}, packages: {} });

const exportSpecSchema = z.object({
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
});

const taskStepFieldsSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  check: z.string().optional(),
  run: z.string().optional(),
  version: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
  workdir: z.string().optional(),
  export: exportSpecSchema.optional(),
});

const taskPlatformsSchema = z
  .record(z.string(), taskStepFieldsSchema)
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

const taskStepSchema = taskStepFieldsSchema.extend({
  id: z.string(),
  platforms: taskPlatformsSchema,
});

const phaseTasksSchema = z.array(taskStepSchema).default([]);

const tasksSchema = z.object({
  install: phaseTasksSchema,
  update: phaseTasksSchema,
  doctor: phaseTasksSchema,
});

const manifestSchema = z
  .object({
    opendock: z.number().optional(),
    id: z.string(),
    name: z.string().optional(),
    summary: z.string().default(""),
    readme: z.string().optional(),
    logo: z.string().optional(),
    requires: requiresSchema,
    files: z.array(fileSpecSchema).default([]),
    install: phaseTasksSchema.optional(),
    update: phaseTasksSchema.optional(),
    doctor: phaseTasksSchema.optional(),
  })
  .strict()
  .transform(({ install, update, doctor, ...manifest }) => ({
    ...manifest,
    tasks: {
      install: install ?? [],
      update: update ?? [],
      doctor: doctor ?? [],
    },
  }));

export type DockManifest = z.infer<typeof manifestSchema>;
export type FileSpec = z.infer<typeof fileSpecSchema>;
export type PackageRequirement = z.infer<typeof packageRequirementSchema>;
export type Requires = z.infer<typeof requiresSchema>;
export type Tasks = z.infer<typeof tasksSchema>;
export type TaskPhase = keyof Tasks;
export type TaskStep = z.infer<typeof taskStepSchema>;
export type ExportSpec = z.infer<typeof exportSpecSchema>;

export class ManifestReader {
  read(path: string): DockManifest {
    try {
      return manifestSchema.parse(YAML.parse(readFileSync(path, "utf8")));
    } catch (error) {
      throw new Error(`failed to parse ${path}: ${(error as Error).message}`);
    }
  }
}

export function parseManifestFile(path: string): DockManifest {
  return new ManifestReader().read(path);
}

export function validateManifestFor(manifest: DockManifest, requested: DockRef): void {
  if (manifest.opendock === undefined) {
    throw new Error("manifest must declare `opendock: 1`");
  }
  if (manifest.opendock !== 1) {
    throw new Error(`unsupported opendock manifest version \`${manifest.opendock}\``);
  }
  if (manifest.id !== requested.id()) {
    throw new Error(
      `manifest id \`${manifest.id}\` does not match requested dock \`${requested}\``,
    );
  }
}

export function assertVersionSatisfiesSelector(version: string, selector: string): void {
  if (version !== selector) {
    throw new Error(`resolved version ${version} does not satisfy selector ${selector}`);
  }
}
