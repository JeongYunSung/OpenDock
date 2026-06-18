import { join } from "node:path";
import { detectPlatform, type OpenDockPlatform } from "../../platform.js";
import { formatStepSymbol, terminalStyle } from "../../terminal-style.js";
import type { DockManifest, TaskPhase, TaskStep } from "../domain/manifest.js";
import { type FileCandidate, FileCandidateCollector } from "../files/file-candidate.js";
import { ensureRealDirectoryPath, safeDockDirectoryName } from "../files/path-utils.js";
import {
  CommandRunner,
  combinedOutput,
  extractVersion,
  failureMessage,
  satisfiesVersion,
} from "./command-runner.js";
import { type ProgressReporter, reportProgress } from "./progress.js";
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
  progress?: ProgressReporter;
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
      dockId: context.dockId,
      phase: context.phase,
      platform,
      projectDir: context.projectDir,
      ...(context.live === undefined ? {} : { live: context.live }),
      ...(context.progress === undefined ? {} : { progress: context.progress }),
    });
    const steps = selectTaskSteps(manifest.tasks[context.phase] ?? [], platform);
    reportProgress(context.progress, {
      level: "RUN",
      message:
        steps.length === 0
          ? `No ${context.phase} task steps`
          : `Planned ${steps.length} ${context.phase} task step(s)`,
      percent: steps.length === 0 ? 100 : 5,
      phase: "tasks-plan",
      total: steps.length,
      ...(context.dockId === undefined ? {} : { dockId: context.dockId }),
    });
    if (context.phase === "doctor") {
      const result = this.runDoctorSteps(steps, context, platform, manifest.permission);
      return { reports: [...requirementReports, ...result.reports], exports: result.exports };
    }
    const result = this.runSetupSteps(steps, context, platform, manifest.permission);
    return { reports: [...requirementReports, ...result.reports], exports: result.exports };
  }

  dockWorkdir(projectDir: string, dockId: string): string {
    return join(projectDir, ".opendock", "workdirs", safeDockDirectoryName(dockId));
  }

  private runSetupSteps(
    steps: TaskStep[],
    context: TaskContext,
    platform: OpenDockPlatform,
    permissions: string[],
  ): TaskRunResult {
    const reports: StepReport[] = [];
    const exports: FileCandidate[] = [];
    for (const [index, step] of steps.entries()) {
      const current = index + 1;
      const total = steps.length;
      const cwd = this.resolveWorkdir(step, context.projectDir, context.dockId);
      this.progress(context, step, "task-check", `Checking ${step.id}`, current, total, 0.12);
      const checkResult = step.check
        ? this.evaluateStepCheck(step, cwd, platform, permissions)
        : { passed: false };
      if (checkResult.passed) {
        console.log(`${formatStepSymbol("✓")} ${terminalStyle.bold(step.id)}: ready`);
        this.progress(
          context,
          step,
          "task-ready",
          `${step.id} is ready`,
          current,
          total,
          0.9,
          "OK",
        );
        reports.push({ id: step.id, name: stepName(step), status: "Ready" });
        this.progress(
          context,
          step,
          "task-export",
          `Collecting exports for ${step.id}`,
          current,
          total,
          0.95,
        );
        exports.push(...this.collectStepExports(step, cwd));
        continue;
      }

      if (step.run) {
        console.log(
          `${formatStepSymbol("->")} ${terminalStyle.bold(step.id)}: ${terminalStyle.dim(
            step.run,
          )}`,
        );
        this.progress(context, step, "task-run", `Running ${step.id}`, current, total, 0.35);
        const runOptions = {
          cwd,
          live: context.live ?? true,
          platform,
          permissions,
          ...(step.timeout_ms === undefined ? {} : { timeoutMs: step.timeout_ms }),
        };
        const result = this.commandRunner.run(step.run, runOptions);
        if (!result.success) {
          reports.push({ id: step.id, name: stepName(step), status: "Failed" });
          const message = failureMessage(result);
          this.progress(
            context,
            step,
            "task-failed",
            message ? `${step.id} failed: ${message}` : `${step.id} failed`,
            current,
            total,
            0.65,
            "ERR",
          );
          const suffix = message ? `: ${message}` : "";
          throw new Error(`step \`${step.id}\` exited with non-zero status${suffix}`);
        }
        if (step.check) {
          this.progress(context, step, "task-verify", `Verifying ${step.id}`, current, total, 0.75);
          const postRunCheck = this.evaluateStepCheck(step, cwd, platform, permissions);
          if (!postRunCheck.passed) {
            const report: StepReport = { id: step.id, name: stepName(step), status: "Failed" };
            if (postRunCheck.message) {
              report.message = postRunCheck.message;
            }
            reports.push(report);
            this.progress(
              context,
              step,
              "task-failed",
              postRunCheck.message
                ? `${step.id} verification failed: ${postRunCheck.message}`
                : `${step.id} verification failed`,
              current,
              total,
              0.8,
              "ERR",
            );
            const message = postRunCheck.message ? `: ${postRunCheck.message}` : "";
            throw new Error(`step \`${step.id}\` did not satisfy its check after run${message}`);
          }
        }
        console.log(`${formatStepSymbol("✓")} ${terminalStyle.bold(step.id)}: ran`);
        this.progress(context, step, "task-ran", `${step.id} ran`, current, total, 0.9, "OK");
        reports.push({ id: step.id, name: stepName(step), status: "Ran" });
        this.progress(
          context,
          step,
          "task-export",
          `Collecting exports for ${step.id}`,
          current,
          total,
          0.95,
        );
        exports.push(...this.collectStepExports(step, cwd));
      }
    }
    return { reports, exports };
  }

  private progress(
    context: TaskContext,
    step: TaskStep,
    phase: string,
    message: string,
    current: number,
    total: number,
    offset: number,
    level: "ERR" | "OK" | "RUN" = "RUN",
  ): void {
    reportProgress(context.progress, {
      current,
      level,
      message,
      percent: stepProgressPercent(current, total, offset),
      phase,
      stepId: step.id,
      total,
      ...(context.dockId === undefined ? {} : { dockId: context.dockId }),
    });
  }

  private runDoctorSteps(
    steps: TaskStep[],
    context: TaskContext,
    platform: OpenDockPlatform,
    permissions: string[],
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
        permissions,
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
      const relativeWorkdir = `.opendock/workdirs/${safeDockDirectoryName(dockId)}`;
      ensureRealDirectoryPath(projectDir, relativeWorkdir, "dock workdir");
      return join(projectDir, relativeWorkdir);
    }
    throw new Error(`unsupported task workdir \`${workdir}\`; use root or dock`);
  }

  private evaluateStepCheck(
    step: TaskStep,
    cwd: string,
    platform: OpenDockPlatform,
    permissions: string[],
  ): { passed: boolean; message?: string } {
    if (!step.check) {
      return { passed: false };
    }
    const result = this.commandRunner.run(step.check, {
      cwd,
      missingAsFailure: true,
      platform,
      permissions,
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

function assertManifestSupportsPlatform(manifest: DockManifest, platform: OpenDockPlatform): void {
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

function stepProgressPercent(current: number, total: number, offset: number): number {
  const slotCount = Math.max(total, 1);
  const slotSize = 100 / slotCount;
  return Math.min(98, Math.round(slotSize * (current - 1 + offset)));
}
