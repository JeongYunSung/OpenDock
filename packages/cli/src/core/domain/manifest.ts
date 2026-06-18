import { readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { isOpenDockPlatform } from "../../platform.js";
import { commandRunnerNames } from "./command-runners.js";
import { isSupportedRuntimeName } from "./runtime-names.js";

const safeSegmentPattern = /^[A-Za-z0-9._-]+$/;
const versionSelectorPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
const blockedShellTokens = ["|", "&&", "||", ";", "`", "$(", ">", "<"];
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

const workdirSpecSchema = z
  .object({
    files: z.array(fileSpecSchema).default([]),
  })
  .strict()
  .default({ files: [] });

const runtimeRequirementsSchema = z
  .record(
    z.string().regex(/^[A-Za-z0-9._-]+$/, "runtime name must be a safe identifier"),
    z.string(),
  )
  .default({})
  .superRefine((runtimes, context) => {
    for (const runtime of Object.keys(runtimes)) {
      if (!isSupportedRuntimeName(runtime)) {
        context.addIssue({
          code: "custom",
          message: `unsupported required runtime \`${runtime}\``,
          path: [runtime],
        });
      }
    }
  });

const requiresSchema = z
  .object({
    runtimes: runtimeRequirementsSchema,
  })
  .strict()
  .default({ runtimes: {} });

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

const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "tags must be lowercase slugs");

const tagsSchema = z
  .array(tagSchema)
  .max(12)
  .superRefine((tags, context) => {
    const seen = new Set<string>();
    for (const [index, tag] of tags.entries()) {
      if (seen.has(tag)) {
        context.addIssue({
          code: "custom",
          message: `duplicate tag \`${tag}\``,
          path: [index],
        });
      }
      seen.add(tag);
    }
  })
  .default([]);

const commandNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, "command names must be lowercase slugs");

const commandRunnerSchema = z.enum(commandRunnerNames);

const commandSpecSchema = z
  .object({
    description: z.string().max(240).optional(),
    file: z.string(),
    runner: commandRunnerSchema,
  })
  .strict();

const commandsSchema = z.record(commandNameSchema, commandSpecSchema).default({});

const permissionSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(240)
      .superRefine((permission, context) => {
        if (blockedShellTokens.some((token) => permission.includes(token))) {
          context.addIssue({
            code: "custom",
            message: `shell operators are not allowed in permission command \`${permission}\``,
          });
        }
      }),
  )
  .max(32)
  .default([]);

const manifestSchema = z
  .object({
    opendock: z.number().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    summary: z.string().default(""),
    readme: z.string().optional(),
    logo: z.string().optional(),
    tags: tagsSchema,
    permission: permissionSchema,
    commands: commandsSchema,
    requires: requiresSchema,
    workdir: workdirSpecSchema,
    files: z.array(fileSpecSchema).default([]),
    install: phaseTasksSchema.optional(),
    update: phaseTasksSchema.optional(),
    doctor: phaseTasksSchema.optional(),
  })
  .strict()
  .transform(({ install, update, doctor, id, ...manifest }) => ({
    ...manifest,
    id: id ?? "",
    tasks: {
      install: install ?? [],
      update: update ?? [],
      doctor: doctor ?? [],
    },
  }));

export type FileSpec = z.infer<typeof fileSpecSchema>;
type WorkdirSpec = z.infer<typeof workdirSpecSchema>;
type Tasks = z.infer<typeof tasksSchema>;
export type TaskPhase = keyof Tasks;
export type TaskStep = z.infer<typeof taskStepSchema>;
export type CommandSpec = z.infer<typeof commandSpecSchema>;
type ParsedDockManifest = z.infer<typeof manifestSchema>;
export type DockManifest = Omit<ParsedDockManifest, "workdir"> & { workdir?: WorkdirSpec };

class ManifestReader {
  read(path: string): DockManifest {
    try {
      return manifestSchema.parse(YAML.parse(readFileSync(path, "utf8")));
    } catch (error) {
      throw new Error(formatManifestReadError(path, error));
    }
  }
}

function formatManifestReadError(path: string, error: unknown): string {
  if (error instanceof z.ZodError) {
    return formatManifestSchemaError(path, error);
  }
  return `failed to parse ${path}: ${(error as Error).message}`;
}

function formatManifestSchemaError(path: string, error: z.ZodError): string {
  const unsupportedFields = unsupportedManifestFields(error);
  if (unsupportedFields.length > 0) {
    const fields = unsupportedFields.map((field) => `\`${field}\``).join(", ");
    const legacyHint = unsupportedFields.some(isLikelyLegacyManifestField)
      ? " This dock may use an older OpenDock v1 manifest format."
      : "";
    return [
      `failed to parse ${path}: unsupported dock.yml field${unsupportedFields.length === 1 ? "" : "s"} ${fields}.`,
      legacyHint,
      " Update the dock release or upgrade OpenDock CLI before installing or updating it.",
    ].join("");
  }

  const issue = error.issues[0];
  if (issue === undefined) {
    return `failed to parse ${path}: invalid dock.yml manifest`;
  }
  const field = issue.path.length > 0 ? ` field \`${issue.path.join(".")}\`` : "";
  return `failed to parse ${path}: invalid dock.yml${field}: ${issue.message}`;
}

function unsupportedManifestFields(error: z.ZodError): string[] {
  const fields: string[] = [];
  for (const issue of error.issues) {
    if (issue.code !== "unrecognized_keys") {
      continue;
    }
    const pathPrefix = issue.path.map(String).join(".");
    for (const key of issue.keys) {
      fields.push(pathPrefix.length > 0 ? `${pathPrefix}.${key}` : key);
    }
  }
  return fields;
}

function isLikelyLegacyManifestField(field: string): boolean {
  return (
    field === "schema" ||
    field === "kind" ||
    field === "lifecycle" ||
    field === "needs" ||
    field === "supports" ||
    field === "version" ||
    field.startsWith("requires.tools") ||
    field.startsWith("requires.packages") ||
    field.endsWith(".update")
  );
}

export function parseManifestFile(path: string): DockManifest {
  return new ManifestReader().read(path);
}

function validateManifestFor(manifest: DockManifest, requested: DockRef): void {
  if (manifest.opendock === undefined) {
    throw new Error("manifest must declare `opendock: 1`");
  }
  if (manifest.opendock !== 1) {
    throw new Error(`unsupported opendock manifest version \`${manifest.opendock}\``);
  }
  if (manifest.id !== "" && manifest.id !== requested.id()) {
    throw new Error(
      `manifest id \`${manifest.id}\` does not match requested dock \`${requested}\``,
    );
  }
}

export function manifestForRef(manifest: DockManifest, requested: DockRef): DockManifest {
  validateManifestFor(manifest, requested);
  return {
    ...manifest,
    id: requested.id(),
  };
}

export function assertVersionSatisfiesSelector(version: string, selector: string): void {
  if (version !== selector) {
    throw new Error(`resolved version ${version} does not satisfy selector ${selector}`);
  }
}
