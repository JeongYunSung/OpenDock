import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, parse, relative, resolve, sep } from "node:path";
import { detectPlatform, type OpenDockPlatform } from "../../platform.js";
import { formatStepSymbol, terminalStyle } from "../../terminal-style.js";
import type { DockManifest, TaskPhase } from "../domain/manifest.js";
import { isSupportedRuntimeName } from "../domain/runtime-names.js";
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
import {
  projectBinDir,
  projectCommandPathEntries,
  sharedRuntimeBinDir,
  sharedRuntimeRoot,
} from "./project-layout.js";
import {
  OpenDockRuntimeInstaller,
  type RuntimeInstaller,
  type RuntimeInstallResult,
} from "./runtime-installer.js";
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
  source: "host" | "managed";
  version: string;
  path: string;
  commands: string[];
}

export interface RequirementRunResult {
  reports: StepReport[];
  runtimes: RuntimeRecord[];
}

export class RequirementRunner {
  constructor(
    private readonly commandRunner = new CommandRunner(),
    private readonly runtimeInstaller: RuntimeInstaller = new OpenDockRuntimeInstaller(),
  ) {}

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
    const check = this.evaluate(
      definition.check,
      version,
      context.projectDir,
      platform,
      context.phase,
    );
    if (context.phase === "doctor") {
      return {
        report: check.passed
          ? { id, name: runtime, status: "Ready" }
          : failedReport(id, runtime, check.message),
      };
    }
    if (!check.passed) {
      const installed = this.installRuntime(runtime, version, context, platform, current, total);
      if (installed) {
        console.log(`${formatStepSymbol("✓")} ${terminalStyle.bold(id)}: installed`);
        this.progress(context, {
          current,
          id,
          level: "OK",
          message: `${runtime} was installed`,
          phase: "requirement-installed",
          total,
        });
        return { report: { id, name: runtime, status: "Ran" }, runtime: installed };
      }
      this.progress(context, {
        current,
        id,
        level: "ERR",
        message: `${runtime} requirement failed`,
        phase: "requirement-failed",
        total,
      });
      throw new Error(
        `required runtime \`${runtime}\` is missing or does not satisfy ${version}: ${check.message}. OpenDock can install managed Node/npm runtimes directly and Python/pip runtimes when uv is available; otherwise prepare the host runtime or run the relevant bootstrap first.`,
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
    phase: TaskPhase,
  ): { actual?: string; passed: boolean; message: string } {
    const result = this.commandRunner.run(command, {
      cwd: projectDir,
      missingAsFailure: true,
      pathEntries: phase === "doctor" ? projectCommandPathEntries(projectDir) : [],
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
    const binDir = sharedRuntimeBinDir(runtime, version);
    ensureRealDirectory(dirname(binDir), "OpenDock runtime root");
    ensureRealDirectory(binDir, "runtime bin directory");
    const source = resolveCommandPath(runtime, context.projectDir);
    if (!source) {
      throw new Error(
        `required runtime \`${runtime}\` is ready but its executable path could not be resolved`,
      );
    }
    const target = writeRuntimeWrapper(join(binDir, runtime), source, platform);
    createProjectCommandShim({
      command: runtime,
      owner: { dockId: "project", kind: "runtime", name: runtime },
      platform,
      projectDir: context.projectDir,
      target,
    });
    return {
      name: runtime,
      requested,
      source: "host",
      version,
      path: binDir,
      commands: [runtime],
    };
  }

  private installRuntime(
    runtime: string,
    requested: string,
    context: RequirementContext,
    platform: OpenDockPlatform,
    current: number,
    total: number,
  ): RuntimeRecord | undefined {
    this.progress(context, {
      current,
      id: `require-runtime-${runtime}`,
      message: `Installing ${runtime} ${requested}`,
      phase: "requirement-install",
      total,
    });
    const installed = this.runtimeInstaller.install({
      platform,
      projectDir: context.projectDir,
      requested,
      runtime,
    });
    if (!installed) {
      return undefined;
    }
    this.linkInstalledRuntime(runtime, installed, context, platform);
    return {
      commands: installed.commands,
      name: runtime,
      path: installed.path,
      requested,
      source: installed.source,
      version: installed.version,
    };
  }

  private linkInstalledRuntime(
    runtime: string,
    installed: RuntimeInstallResult,
    context: RequirementContext,
    platform: OpenDockPlatform,
  ): void {
    for (const command of installed.commands) {
      const target = installed.targets[command];
      if (!target) {
        throw new Error(`managed runtime \`${runtime}\` did not provide command \`${command}\``);
      }
      createProjectCommandShim({
        command,
        owner: { dockId: "project", kind: "runtime", name: runtime },
        platform,
        projectDir: context.projectDir,
        target,
      });
    }
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

function resolveCommandPath(command: string, projectDir: string): string | undefined {
  const pathValue = opendockCommandPath(process.env.PATH) ?? "";
  const ignoredDirectories = openDockManagedCommandDirectories(projectDir);
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) {
      continue;
    }
    if (isIgnoredCommandDirectory(resolve(entry), ignoredDirectories)) {
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

function openDockManagedCommandDirectories(projectDir: string): Set<string> {
  return new Set([resolve(projectBinDir(projectDir)), resolve(sharedRuntimeRoot())]);
}

function isIgnoredCommandDirectory(path: string, ignoredDirectories: Set<string>): boolean {
  for (const directory of ignoredDirectories) {
    if (path === directory || path.startsWith(`${directory}${sep}`)) {
      return true;
    }
  }
  return false;
}

function commandCandidates(directory: string, command: string): string[] {
  if (process.platform === "win32") {
    return [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`].map((name) =>
      join(directory, name),
    );
  }
  return [join(directory, command)];
}

function writeRuntimeWrapper(target: string, source: string, platform: OpenDockPlatform): string {
  ensureRealDirectory(dirname(target), "runtime wrapper directory");
  if (platform === "windows") {
    const cmdTarget = `${target}.cmd`;
    assertRuntimeWrapperWritable(cmdTarget);
    writeFileSync(cmdTarget, `@echo off\r\n"${source}" %*\r\n`);
    return cmdTarget;
  }
  assertRuntimeWrapperWritable(target);
  writeFileSync(target, `#!/usr/bin/env sh\nexec "${source}" "$@"\n`, { mode: 0o755 });
  return target;
}

function ensureRealDirectory(path: string, label: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of relative(root, absolute)
    .split(/[/\\]+/)
    .filter(Boolean)) {
    current = join(current, part);
    const stat = lstatIfPresent(current);
    if (!stat) {
      mkdirSync(current);
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} cannot be a symlink: ${path}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${label} must be a directory: ${path}`);
    }
  }
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function assertRuntimeWrapperWritable(path: string): void {
  const stat = lstatIfPresent(path);
  if (!stat) {
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`runtime wrapper cannot be a symlink: ${path}`);
  }
  if (!stat.isFile()) {
    throw new Error(`runtime wrapper path must be a file: ${path}`);
  }
}
