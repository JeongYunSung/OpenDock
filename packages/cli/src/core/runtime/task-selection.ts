import type { OpenDockPlatform } from "../../platform.js";
import type { DockManifest, TaskPhase, TaskStep } from "../domain/manifest.js";

export function assertManifestSupportsPlatform(
  manifest: DockManifest,
  platform: OpenDockPlatform,
): void {
  const supported = collectManifestPlatforms(manifest);
  if (supported.size === 0 || supported.has(platform)) {
    return;
  }
  throw new Error(
    `dock \`${manifest.id}\` does not support platform \`${platform}\`; available platforms: ${[
      ...supported,
    ].join(", ")}`,
  );
}

export function selectTaskSteps(steps: TaskStep[], platform: OpenDockPlatform): TaskStep[] {
  return steps.flatMap((step) => {
    const platformKeys = Object.keys(step.platforms ?? {});
    if (platformKeys.length === 0) {
      return [step];
    }
    const override = step.platforms?.[platform];
    if (!override) {
      return [];
    }
    return [
      {
        ...step,
        ...override,
        id: step.id,
        platforms: {},
      },
    ];
  });
}

function collectManifestPlatforms(manifest: DockManifest): Set<string> {
  const platforms = new Set<string>();
  const phases: TaskPhase[] = ["install", "update", "doctor"];
  for (const phase of phases) {
    for (const step of manifest.tasks[phase] ?? []) {
      for (const platform of Object.keys(step.platforms ?? {})) {
        platforms.add(platform);
      }
    }
  }
  return platforms;
}
