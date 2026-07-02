import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { detectPlatform, type OpenDockPlatform } from "../../platform.js";
import { formatStepSymbol, terminalStyle } from "../../terminal-style.js";
import type { DockManifest, TaskPhase } from "../domain/manifest.js";
import { isSupportedRuntimeName } from "../domain/runtime-names.js";
import { ensureRealDirectoryPath } from "../files/path-utils.js";
import {
  CommandRunner,
  combinedOutput,
  extractVersion,
  failureMessage,
  opendockCommandPath,
  satisfiesVersion,
} from "./command-runner.js";
import { createProjectCommandShim } from "./command-shim.js";
import { type ProgressReporter, reportProgress } from "./progress.js";
import { projectCommandPathEntries, relativeProjectPath, runtimeBinDir } from "./project-layout.js";
import { runtimeDefinitions } from "./runtime-requirements.js";
import { type StepReport, stepProgressPercent } from "./step-report.js";

interface RequirementContext {
  dockId?: string;
  live?: boolean;
  phase: TaskPhase;
  platform?: OpenDockPlatform;
  progress?: ProgressReporter;
  projectDir: string;
}

export interface RuntimeRecord {
  name: string;
  requested: string;
  version: string;
  path: string;
  commands: string[];
}

export interface RequirementRunResult {
  reports: StepReport[];
  runtimes: RuntimeRecord[];
}

export class RequirementRunner {
  constructor(private readonly commandRunner = new CommandRunner()) {}

  run(manifest: DockManifest, context: RequirementContext): RequirementRunResult {
    const platform = context.platform ?? detectPlatform();
    const reports: StepReport[] = [];
    const runtimeRecords: RuntimeRecord[] = [];
    const runtimes = Object.entries(manifest.requires.runtimes);
    for (const [index, [runtime, version]] of runtimes.entries()) {
      const result = this.runRuntime(
        runtime,
        version,
        context,
        platform,
        index + 1,
        runtimes.length,
      );
      reports.push(result.report);
      if (result.runtime) {
        runtimeRecords.push(result.runtime);
      }
    }
    return { reports, runtimes: runtimeRecords };
  }

  private runRuntime(
    runtime: string,
    version: string,
    context: RequirementContext,
    platform: OpenDockPlatform,
    current: number,
    total: number,
  ): { report: StepReport; runtime?: RuntimeRecord } {
    const id = `require-runtime-${runtime}`;
    if (!isSupportedRuntimeName(runtime)) {
      throw new Error(`unsupported required runtime \`${runtime}\``);
    }
    const definition = runtimeDefinitions[runtime];
    this.progress(context, {
      current,
      id,
      message: `Checking ${runtime} ${version}`,
      phase: "requirement-check",
      total,
    });
    const check = this.evaluate(definition.check, version, context.projectDir, platform);
    if (context.phase === "doctor") {
      return {
        report: check.passed
          ? { id, name: runtime, status: "Ready" }
          : failedReport(id, runtime, check.message),
      };
    }
    if (!check.passed) {
      this.progress(context, {
        current,
        id,
        level: "ERR",
        message: `${runtime} requirement failed`,
        phase: "requirement-failed",
        total,
      });
      throw new Error(
        `required runtime \`${runtime}\` is missing or does not satisfy ${version}: ${check.message}. OpenDock no longer installs runtimes globally; prepare the host runtime or use project-local toolchain support.`,
      );
    }

    const runtimeRecord = this.prepareRuntime(runtime, version, check.actual, context, platform);
    console.log(`${formatStepSymbol("✓")} ${terminalStyle.bold(id)}: ready`);
    this.progress(context, {
      current,
      id,
      level: "OK",
      message: `${runtime} is ready`,
      phase: "requirement-ready",
      total,
    });
    return { report: { id, name: runtime, status: "Ready" }, runtime: runtimeRecord };
  }

  private progress(
    context: RequirementContext,
    event: {
      current: number;
      id: string;
      level?: "ERR" | "OK" | "RUN";
      message: string;
      phase: string;
      total: number;
    },
  ): void {
    reportProgress(context.progress, {
      current: event.current,
      level: event.level ?? "RUN",
      message: event.message,
      percent: stepProgressPercent(event.current, event.total, event.level === "OK" ? 0.9 : 0.2),
      phase: event.phase,
      stepId: event.id,
      total: event.total,
      ...(context.dockId === undefined ? {} : { dockId: context.dockId }),
    });
  }

  private evaluate(
    command: string,
    version: string,
    projectDir: string,
    platform: OpenDockPlatform,
  ): { actual?: string; passed: boolean; message: string } {
    const result = this.commandRunner.run(command, {
      cwd: projectDir,
      missingAsFailure: true,
      pathEntries: projectCommandPathEntries(projectDir),
      platform,
    });
    if (!result.success) {
      return { passed: false, message: failureMessage(result) ?? `${command} failed` };
    }
    const actual = extractVersion(combinedOutput(result));
    if (!actual) {
      return { passed: false, message: `could not read version from ${command}` };
    }
    if (!satisfiesVersion(actual, version)) {
      return { actual, passed: false, message: `${actual} does not satisfy ${version}` };
    }
    return { actual, passed: true, message: `${actual} satisfies ${version}` };
  }

  private prepareRuntime(
    runtime: string,
    requested: string,
    actual: string | undefined,
    context: RequirementContext,
    platform: OpenDockPlatform,
  ): RuntimeRecord {
    const version = actual ?? "unknown";
    const binDir = runtimeBinDir(context.projectDir, runtime, version);
    ensureRealDirectoryPath(
      context.projectDir,
      relativeProjectPath(context.projectDir, binDir),
      "runtime bin directory",
    );
    const source = resolveCommandPath(runtime);
    if (!source) {
      throw new Error(
        `required runtime \`${runtime}\` is ready but its executable path could not be resolved`,
      );
    }
    const target = join(binDir, runtime);
    writeRuntimeWrapper(target, source, platform);
    createProjectCommandShim({
      command: runtime,
      owner: { dockId: context.dockId ?? "project", kind: "runtime", name: runtime },
      platform,
      projectDir: context.projectDir,
      target,
    });
    return {
      name: runtime,
      requested,
      version,
      path: relativeProjectPath(context.projectDir, binDir),
      commands: [runtime],
    };
  }
}

function failedReport(id: string, name: string, message: string): StepReport {
  return {
    id,
    name,
    status: "Failed",
    message,
  };
}

function resolveCommandPath(command: string): string | undefined {
  const pathValue = opendockCommandPath(process.env.PATH) ?? "";
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) {
      continue;
    }
    for (const candidate of commandCandidates(entry, command)) {
      if (existsSync(candidate)) {
        return resolve(candidate);
      }
    }
  }
  return undefined;
}

function commandCandidates(directory: string, command: string): string[] {
  if (process.platform === "win32") {
    return [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`].map((name) =>
      join(directory, name),
    );
  }
  return [join(directory, command)];
}

function writeRuntimeWrapper(target: string, source: string, platform: OpenDockPlatform): void {
  mkdirSync(join(target, ".."), { recursive: true });
  if (platform === "windows") {
    writeFileSync(`${target}.cmd`, `@echo off\r\n"${source}" %*\r\n`);
  }
  writeFileSync(target, `#!/usr/bin/env sh\nexec "${source}" "$@"\n`, { mode: 0o755 });
}
