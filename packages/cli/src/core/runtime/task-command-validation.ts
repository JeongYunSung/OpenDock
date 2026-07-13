import type { OpenDockPlatform } from "../../platform.js";
import type { DockManifest, TaskPhase, TaskStep } from "../domain/manifest.js";
import { assertSafeDependencyPath, assertSafeRelativePath } from "../files/path-utils.js";
import {
  ensureAllowed,
  isDefaultCommandProgram,
  rejectShellMetacharacters,
  splitCommand,
} from "./command-policy.js";
import { assertManifestSupportsPlatform, selectTaskSteps } from "./task-selection.js";
import { toolCommandPermissions } from "./tool-runner.js";

const taskPhases: TaskPhase[] = ["install", "update", "doctor"];
const commandFields = ["check", "run"] as const;

export function validateManifestTaskCommands(
  manifest: DockManifest,
  platform: OpenDockPlatform,
): void {
  assertManifestSupportsPlatform(manifest, platform);
  validateManifestDependencies(manifest);
  const permissions = manifestTaskPermissions(manifest, platform);
  const permissionPrograms = manifestTaskPermissionPrograms(manifest);

  for (const phase of taskPhases) {
    for (const step of selectTaskSteps(manifest.tasks[phase] ?? [], platform)) {
      validateTaskStepCommands(phase, step, platform, permissions, permissionPrograms);
    }
  }
}

function validateManifestDependencies(manifest: DockManifest): void {
  for (const [name, dependency] of Object.entries(manifest.dependencies ?? {})) {
    try {
      assertSafeDependencyPath(dependency.path, "dependency path");
      for (const integrity of dependency.integrity) {
        assertSafeRelativePath(integrity.path, "dependency integrity path");
      }
    } catch (error) {
      throw new Error(`invalid dependency \`${name}\` path: ${(error as Error).message}`);
    }
  }
}

export function manifestTaskPermissions(
  manifest: DockManifest,
  platform: OpenDockPlatform,
): string[] {
  validateManifestPermissions(manifest, platform);
  return [...manifest.permission, ...toolCommandPermissions(manifest)];
}

export function manifestTaskPermissionPrograms(manifest: DockManifest): string[] {
  return [...new Set(Object.values(manifest.tools ?? {}).flatMap((tool) => tool.commands))];
}

function validateManifestPermissions(manifest: DockManifest, platform: OpenDockPlatform): void {
  const toolCommands = new Set(manifestTaskPermissionPrograms(manifest));

  for (const permission of manifest.permission) {
    try {
      rejectShellMetacharacters(permission);
      const [program, ...args] = splitCommand(permission);
      if (!program) {
        throw new Error(`empty permission command: ${permission}`);
      }
      if (!isDefaultCommandProgram(program, platform) && !toolCommands.has(program)) {
        throw new Error(
          `permission command \`${permission}\` uses \`${program}\`, but \`${program}\` is not declared in tools.commands and is not an OpenDock default command`,
        );
      }
      ensureAllowed(program, args, platform, [permission], [...toolCommands]);
    } catch (error) {
      throw new Error(`invalid permission \`${permission}\`: ${(error as Error).message}`);
    }
  }
}

function validateTaskStepCommands(
  phase: TaskPhase,
  step: TaskStep,
  platform: OpenDockPlatform,
  permissions: string[],
  permissionPrograms: string[],
): void {
  for (const field of commandFields) {
    const command = step[field];
    if (command === undefined) {
      continue;
    }
    try {
      rejectShellMetacharacters(command);
      const [program, ...args] = splitCommand(command);
      if (!program) {
        throw new Error(`empty command: ${command}`);
      }
      ensureAllowed(program, args, platform, permissions, permissionPrograms);
    } catch (error) {
      throw new Error(`invalid ${phase} step \`${step.id}\` ${field}: ${(error as Error).message}`);
    }
  }
}
