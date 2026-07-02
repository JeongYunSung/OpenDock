import type { OpenDockPlatform } from "../../platform.js";
import type { DockManifest, TaskPhase, TaskStep } from "../domain/manifest.js";
import { ensureAllowed, rejectShellMetacharacters, splitCommand } from "./command-policy.js";
import { assertManifestSupportsPlatform, selectTaskSteps } from "./task-selection.js";
import { toolCommandPermissions } from "./tool-runner.js";

const taskPhases: TaskPhase[] = ["install", "update", "doctor"];
const commandFields = ["check", "run"] as const;

export function validateManifestTaskCommands(
  manifest: DockManifest,
  platform: OpenDockPlatform,
): void {
  assertManifestSupportsPlatform(manifest, platform);

  for (const phase of taskPhases) {
    for (const step of selectTaskSteps(manifest.tasks[phase] ?? [], platform)) {
      validateTaskStepCommands(phase, step, platform, [
        ...manifest.permission,
        ...toolCommandPermissions(manifest),
      ]);
    }
  }
}

function validateTaskStepCommands(
  phase: TaskPhase,
  step: TaskStep,
  platform: OpenDockPlatform,
  permissions: string[],
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
      ensureAllowed(program, args, platform, permissions);
    } catch (error) {
      throw new Error(`invalid ${phase} step \`${step.id}\` ${field}: ${(error as Error).message}`);
    }
  }
}
