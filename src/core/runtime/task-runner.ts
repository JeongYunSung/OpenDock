import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { detectPlatform, type OpenDockPlatform } from "../../platform.js";
import { formatStepSymbol, terminalStyle } from "../../terminal-style.js";
import type { DockManifest, TaskPhase, TaskStep } from "../domain/manifest.js";
import { type FileCandidate, FileCandidateCollector } from "../files/file-candidate.js";
import { safeDockDirectoryName } from "../files/path-utils.js";
import {
  CommandRunner,
  combinedOutput,
  extractVersion,
  failureMessage,
  satisfiesVersion,
} from "./command-runner.js";
import { RequirementRunner } from "./requirement-runner.js";

export interface StepReport {
  id: string;
  name: string;
  status: "Ready" | "Ran" | "Failed";
  message?: string;
}

export interface TaskRunResult {
  reports: StepReport[];
  exports: FileCandidate[];
}

export interface TaskContext {
  projectDir: string;
  dockId: string;
  phase: TaskPhase;
  platform?: OpenDockPlatform;
  live?: boolean;
}

const defaultDoctorTimeoutMs = 30_000;

export class TaskRunner {
  constructor(
    private readonly commandRunner = new CommandRunner(),
    private readonly collector = new FileCandidateCollector(),
    private readonly requirementRunner = new RequirementRunner(commandRunner),
  ) {}

  run(manifest: DockManifest, context: TaskContext): TaskRunResult {
    const platform = context.platform ?? detectPlatform();
    assertManifestSupportsPlatform(manifest, platform);
    const requirementReports = this.requirementRunner.run(manifest, {
      phase: context.phase,
      platform,
      projectDir: context.projectDir,
      ...(context.live === undefined ? {} : { live: context.live }),
    });
    const steps = selectTaskSteps(manifest.tasks[context.phase] ?? [], platform);
    if (context.phase === "doctor") {
      const result = this.runDoctorSteps(steps, context, platform);
      return { reports: [...requirementReports, ...result.reports], exports: result.exports };
    }
    const result = this.runSetupSteps(steps, context, platform);
    return { reports: [...requirementReports, ...result.reports], exports: result.exports };
  }

  dockWorkdir(projectDir: string, dockId: string): string {
    return join(projectDir, ".opendock", "workdirs", safeDockDirectoryName(dockId));
  }

  private runSetupSteps(
    steps: TaskStep[],
    context: TaskContext,
    platform: OpenDockPlatform,
  ): TaskRunResult {
    const reports: StepReport[] = [];
    const exports: FileCandidate[] = [];
    for (const step of steps) {
      const cwd = this.resolveWorkdir(step, context.projectDir, context.dockId);
      const checkResult = step.check
        ? this.evaluateStepCheck(step, cwd, platform)
        : { passed: false };
      if (checkResult.passed) {
        console.log(`${formatStepSymbol("✓")} ${terminalStyle.bold(step.id)}: ready`);
        reports.push({ id: step.id, name: stepName(step), status: "Ready" });
        exports.push(...this.collectStepExports(step, cwd));
        continue;
      }

      if (step.run) {
        console.log(
          `${formatStepSymbol("->")} ${terminalStyle.bold(step.id)}: ${terminalStyle.dim(
            step.run,
          )}`,
        );
        const runOptions = {
          cwd,
          live: context.live ?? true,
          platform,
          ...(step.timeout_ms === undefined ? {} : { timeoutMs: step.timeout_ms }),
        };
        const result = this.commandRunner.run(step.run, runOptions);
        if (!result.success) {
          reports.push({ id: step.id, name: stepName(step), status: "Failed" });
          const message = failureMessage(result);
          const suffix = message ? `: ${message}` : "";
          throw new Error(`step \`${step.id}\` exited with non-zero status${suffix}`);
        }
        if (step.check) {
          const postRunCheck = this.evaluateStepCheck(step, cwd, platform);
          if (!postRunCheck.passed) {
            const report: StepReport = { id: step.id, name: stepName(step), status: "Failed" };
            if (postRunCheck.message) {
              report.message = postRunCheck.message;
            }
            reports.push(report);
            const message = postRunCheck.message ? `: ${postRunCheck.message}` : "";
            throw new Error(`step \`${step.id}\` did not satisfy its check after run${message}`);
          }
        }
        console.log(`${formatStepSymbol("✓")} ${terminalStyle.bold(step.id)}: ran`);
        reports.push({ id: step.id, name: stepName(step), status: "Ran" });
        exports.push(...this.collectStepExports(step, cwd));
      }
    }
    return { reports, exports };
  }

  private runDoctorSteps(
    steps: TaskStep[],
    context: TaskContext,
    platform: OpenDockPlatform,
  ): TaskRunResult {
    const reports: StepReport[] = [];
    for (const step of steps) {
      const command = step.run ?? step.check;
      if (!command) {
        reports.push({ id: step.id, name: stepName(step), status: "Ready" });
        continue;
      }
      const cwd = this.resolveWorkdir(step, context.projectDir, context.dockId);
      const result = this.commandRunner.run(command, {
        cwd,
        missingAsFailure: true,
        platform,
        timeoutMs: step.timeout_ms ?? defaultDoctorTimeoutMs,
      });
      if (!result.success) {
        const report: StepReport = { id: step.id, name: stepName(step), status: "Failed" };
        const message = failureMessage(result);
        if (message) {
          report.message = message;
        }
        reports.push(report);
        continue;
      }

      if (step.version) {
        const actual = extractVersion(combinedOutput(result));
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
    return { reports, exports: [] };
  }

  private resolveWorkdir(step: TaskStep, projectDir: string, dockId: string): string {
    const workdir = step.workdir ?? "root";
    if (workdir === "root") {
      return projectDir;
    }
    if (workdir === "dock") {
      const path = this.dockWorkdir(projectDir, dockId);
      mkdirSync(path, { recursive: true });
      return path;
    }
    throw new Error(`unsupported task workdir \`${workdir}\`; use root or dock`);
  }

  private evaluateStepCheck(
    step: TaskStep,
    cwd: string,
    platform: OpenDockPlatform,
  ): { passed: boolean; message?: string } {
    if (!step.check) {
      return { passed: false };
    }
    const result = this.commandRunner.run(step.check, {
      cwd,
      missingAsFailure: true,
      platform,
      ...(step.timeout_ms === undefined ? {} : { timeoutMs: step.timeout_ms }),
    });
    if (!result.success) {
      return { passed: false };
    }
    if (!step.version) {
      return { passed: true };
    }
    const actual = extractVersion(combinedOutput(result));
    if (!actual) {
      return { passed: false, message: `could not read version from ${step.check}` };
    }
    if (!satisfiesVersion(actual, step.version)) {
      return { passed: false, message: `${actual} does not satisfy ${step.version}` };
    }
    return { passed: true };
  }

  private collectStepExports(step: TaskStep, cwd: string): FileCandidate[] {
    if (!step.export) {
      return [];
    }
    const include = step.export.include.length === 0 ? ["**"] : step.export.include;
    return this.collector.collectExport(cwd, include, step.export.exclude, "export");
  }
}

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

function selectTaskSteps(steps: TaskStep[], platform: OpenDockPlatform): TaskStep[] {
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

function stepName(step: TaskStep): string {
  return step.name ?? step.id;
}
