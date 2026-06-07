import { spawnSync } from "node:child_process";
import type { LifecyclePhase, LifecycleStep, PackManifest } from "./pack.js";

export interface StepReport {
  id: string;
  name: string;
  status: "Ready" | "Ran" | "Failed";
  message?: string;
}

const allowedCommands = new Set([
  "brew",
  "bun",
  "git",
  "mkdir",
  "node",
  "npm",
  "npx",
  "oma",
  "pip",
  "pip3",
  "pipx",
  "pnpm",
  "python",
  "python3",
  "test",
  "uv",
]);

export function getLifecycleSteps(manifest: PackManifest, phase: LifecyclePhase): LifecycleStep[] {
  const lifecycleSteps = manifest.lifecycle[phase] ?? [];
  if (lifecycleSteps.length > 0) {
    return lifecycleSteps;
  }
  if (phase === "install" || phase === "update") {
    return manifest.setup;
  }
  return [];
}

export function hasLifecycleSteps(manifest: PackManifest, phase: LifecyclePhase): boolean {
  return getLifecycleSteps(manifest, phase).length > 0;
}

export function hasExplicitLifecycleSteps(manifest: PackManifest, phase: LifecyclePhase): boolean {
  return (manifest.lifecycle[phase] ?? []).length > 0;
}

export function runLifecycle(
  manifest: PackManifest,
  phase: LifecyclePhase,
  projectDir: string,
): StepReport[] {
  if (phase === "doctor") {
    return runDoctorSteps(getLifecycleSteps(manifest, phase), projectDir);
  }
  return runSetupSteps(getLifecycleSteps(manifest, phase), projectDir);
}

function runSetupSteps(steps: LifecycleStep[], projectDir: string): StepReport[] {
  const reports: StepReport[] = [];
  for (const step of steps) {
    if (step.copy) {
      reports.push({ id: step.id, name: stepName(step), status: "Ready" });
      continue;
    }

    const checkPassed = step.check ? stepCheckPassed(step, projectDir) : false;
    if (checkPassed) {
      reports.push({ id: step.id, name: stepName(step), status: "Ready" });
      continue;
    }

    if (step.run) {
      const result = runCommand(step.run, projectDir);
      if (!result.success) {
        reports.push({ id: step.id, name: stepName(step), status: "Failed" });
        throw new Error(`step \`${step.id}\` exited with non-zero status`);
      }
      reports.push({ id: step.id, name: stepName(step), status: "Ran" });
    }
  }
  return reports;
}

function stepCheckPassed(step: LifecycleStep, projectDir: string): boolean {
  if (!step.check) {
    return false;
  }
  const result = runCommand(step.check, projectDir, { missingAsFailure: true });
  if (!result.success) {
    return false;
  }
  if (!step.version) {
    return true;
  }
  const actual = extractVersion(result.stdout);
  return actual ? satisfiesVersion(actual, step.version) : false;
}

function runDoctorSteps(steps: LifecycleStep[], projectDir: string): StepReport[] {
  const reports: StepReport[] = [];
  for (const step of steps) {
    const command = step.run ?? step.check;
    if (!command) {
      reports.push({ id: step.id, name: stepName(step), status: "Ready" });
      continue;
    }

    const result = runCommand(command, projectDir, { missingAsFailure: true });
    if (!result.success) {
      reports.push({ id: step.id, name: stepName(step), status: "Failed" });
      continue;
    }

    if (step.version && result.stdout) {
      const actual = extractVersion(result.stdout);
      if (!actual || !satisfiesVersion(actual, step.version)) {
        reports.push({
          id: step.id,
          name: stepName(step),
          status: "Failed",
          message: actual
            ? `${actual} does not satisfy ${step.version}`
            : `could not read version from ${command}`,
        });
        continue;
      }
    }

    reports.push({ id: step.id, name: stepName(step), status: "Ready" });
  }
  return reports;
}

export function runCommand(
  command: string,
  cwd: string,
  options: { missingAsFailure?: boolean } = {},
): { success: boolean; stdout: string; stderr: string } {
  rejectShellMetacharacters(command);
  const args = splitCommand(command);
  const [program, ...rest] = args;
  if (!program) {
    throw new Error(`empty command: ${command}`);
  }
  ensureAllowed(program);

  const output = spawnSync(program, rest, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (output.error) {
    if (options.missingAsFailure && (output.error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: false, stdout: "", stderr: output.error.message };
    }
    throw output.error;
  }

  return {
    success: output.status === 0,
    stdout: output.stdout ?? "",
    stderr: output.stderr ?? "",
  };
}

function rejectShellMetacharacters(command: string): void {
  const blocked = ["|", "&&", "||", ";", "`", "$(", ">", "<"];
  if (blocked.some((token) => command.includes(token))) {
    throw new Error(`shell operators are not allowed in lifecycle commands: ${command}`);
  }
}

function ensureAllowed(program: string): void {
  if (!allowedCommands.has(program)) {
    throw new Error(`command \`${program}\` is not allowed in OpenDock setup`);
  }
}

function splitCommand(command: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current !== "") {
        result.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error(`invalid command: ${command}`);
  }
  if (current !== "") {
    result.push(current);
  }
  return result;
}

function stepName(step: LifecycleStep): string {
  return step.name ?? step.id;
}

function extractVersion(output: string): string | undefined {
  return output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0];
}

function satisfiesVersion(actual: string, range: string): boolean {
  for (const condition of range.trim().split(/\s+/)) {
    if (condition === "") {
      continue;
    }
    const match = condition.match(/^(>=|>|<=|<|=)?(.+)$/);
    if (!match) {
      return false;
    }
    const operator = match[1] ?? "=";
    const expected = match[2];
    if (!expected) {
      return false;
    }
    const comparison = compareVersions(actual, expected);
    if (operator === ">=" && comparison < 0) return false;
    if (operator === ">" && comparison <= 0) return false;
    if (operator === "<=" && comparison > 0) return false;
    if (operator === "<" && comparison >= 0) return false;
    if (operator === "=" && comparison !== 0) return false;
  }
  return true;
}

function compareVersions(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = parseVersion(left);
  const [rightMajor, rightMinor, rightPatch] = parseVersion(right);
  for (const delta of [leftMajor - rightMajor, leftMinor - rightMinor, leftPatch - rightPatch]) {
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }
  return 0;
}

function parseVersion(version: string): [number, number, number] {
  const match = version.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    throw new Error(`invalid version \`${version}\``);
  }
  return [
    Number.parseInt(match[1] ?? "0", 10),
    Number.parseInt(match[2] ?? "0", 10),
    Number.parseInt(match[3] ?? "0", 10),
  ];
}
