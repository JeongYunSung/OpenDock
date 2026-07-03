import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import type { OpenDockPlatform } from "../../platform.js";
import { formatStepSymbol, terminalStyle } from "../../terminal-style.js";
import type { DependencySpec, DockManifest, TaskPhase } from "../domain/manifest.js";
import {
  assertRealDirectoryPath,
  assertSafeDependencyPath,
  pruneEmptyDirectoryChain,
  safeJoin,
} from "../files/path-utils.js";
import { opendockCommandPath } from "./command-runner.js";
import { type ProgressReporter, reportProgress } from "./progress.js";
import {
  prependPathEntries,
  projectCommandPathEntries,
  relativeProjectPath,
} from "./project-layout.js";
import { type StepReport, stepProgressPercent } from "./step-report.js";

const defaultDependencyTimeoutMs = 600_000;

export interface DependencyRecord {
  name: string;
  manager: DependencySpec["manager"];
  mode: string;
  path: string;
}

interface DependencyContext {
  dockId: string;
  live?: boolean;
  phase: TaskPhase;
  platform: OpenDockPlatform;
  progress?: ProgressReporter;
  projectDir: string;
}

export interface DependencyRunResult {
  dependencies: DependencyRecord[];
  reports: StepReport[];
}

interface DependencyCommand {
  args: string[];
  program: string;
}

export class DependencyRunner {
  run(manifest: DockManifest, context: DependencyContext): DependencyRunResult {
    const entries = Object.entries(manifest.dependencies ?? {});
    const dependencies: DependencyRecord[] = [];
    const reports: StepReport[] = [];

    for (const [index, [name, spec]] of entries.entries()) {
      const current = index + 1;
      const total = entries.length;
      const result: { dependency?: DependencyRecord; report: StepReport } =
        context.phase === "doctor"
          ? this.checkDependency(name, spec, context, current, total)
          : this.installDependency(name, spec, context, current, total);
      reports.push(result.report);
      if (result.dependency) {
        dependencies.push(result.dependency);
      }
    }

    return { dependencies, reports };
  }

  private checkDependency(
    name: string,
    spec: DependencySpec,
    context: DependencyContext,
    current: number,
    total: number,
  ): { report: StepReport } {
    const id = dependencyStepId(name);
    this.progress(
      context,
      id,
      `Checking dependency ${name}`,
      "dependency-check",
      current,
      total,
      0.2,
    );
    let target: string;
    try {
      target = resolveDependencyPath(context.projectDir, spec.path);
    } catch (error) {
      return {
        report: {
          id,
          name,
          status: "Failed",
          message: (error as Error).message,
        },
      };
    }
    const missing = dependencyOutputPaths(target, spec).filter((path) => !existsSync(path));
    if (missing.length > 0) {
      return {
        report: {
          id,
          name,
          status: "Failed",
          message: `missing dependency output ${relative(context.projectDir, missing[0] ?? target)}`,
        },
      };
    }
    return { report: { id, name, status: "Ready" } };
  }

  private installDependency(
    name: string,
    spec: DependencySpec,
    context: DependencyContext,
    current: number,
    total: number,
  ): { dependency: DependencyRecord; report: StepReport } {
    const id = dependencyStepId(name);
    this.progress(
      context,
      id,
      `Installing dependency ${name}`,
      "dependency-install",
      current,
      total,
      0.3,
    );
    const target = resolveDependencyPath(context.projectDir, spec.path);
    const command = dependencyCommand(target, spec);
    removeDependencyOutputsForSpec(context.projectDir, spec.path, spec);
    console.log(
      `${formatStepSymbol("->")} ${terminalStyle.bold(id)}: ${terminalStyle.dim(
        [command.program, ...command.args].join(" "),
      )}`,
    );
    runDependencyCommand(target, command, spec, context, name);
    console.log(`${formatStepSymbol("✓")} ${terminalStyle.bold(id)}: ready`);
    this.progress(
      context,
      id,
      `${name} dependency is ready`,
      "dependency-ready",
      current,
      total,
      0.9,
      "OK",
    );
    return {
      dependency: {
        name,
        manager: spec.manager,
        mode: spec.mode,
        path: relativeProjectPath(context.projectDir, target),
      },
      report: { id, name, status: "Ready" },
    };
  }

  private progress(
    context: DependencyContext,
    id: string,
    message: string,
    phase: string,
    current: number,
    total: number,
    offset: number,
    level: "ERR" | "OK" | "RUN" = "RUN",
  ): void {
    reportProgress(context.progress, {
      current,
      dockId: context.dockId,
      level,
      message,
      percent: stepProgressPercent(current, total, offset),
      phase,
      stepId: id,
      total,
    });
  }
}

export function removeInstalledDependencyOutputs(
  projectDir: string,
  dependencies: Array<{
    manager: DependencySpec["manager"] | string;
    mode: string;
    name: string;
    path: string;
  }>,
): void {
  for (const dependency of dependencies) {
    removeDependencyOutputsForRecord(projectDir, dependency);
  }
}

function dependencyStepId(name: string): string {
  return `dependency-${name}`;
}

function resolveDependencyPath(projectDir: string, path: string): string {
  const normalized = assertSafeDependencyPath(path, "dependency path");
  const target = safeJoin(projectDir, normalized, "dependency path");
  if (!existsSync(target)) {
    throw new Error(`dependency path does not exist: ${path}`);
  }
  assertRealDirectoryPath(projectDir, normalized, "dependency path");
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw new Error(`dependency path cannot be a symlink: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`dependency path must be a directory: ${path}`);
  }
  return target;
}

function dependencyCommand(target: string, spec: DependencySpec): DependencyCommand {
  if (spec.manager === "npm") {
    return {
      program: "npm",
      args:
        spec.mode === "locked"
          ? ["ci", "--no-audit", "--no-fund"]
          : ["install", "--no-audit", "--no-fund"],
    };
  }
  if (spec.manager === "pnpm") {
    return {
      program: "pnpm",
      args: spec.mode === "locked" ? ["install", "--frozen-lockfile"] : ["install"],
    };
  }
  if (spec.manager === "bun") {
    return {
      program: "bun",
      args: spec.mode === "locked" ? ["install", "--frozen-lockfile"] : ["install"],
    };
  }
  if (spec.manager === "uv") {
    return {
      program: "uv",
      args: spec.mode === "locked" ? ["sync", "--frozen"] : ["sync"],
    };
  }
  const requirements = join(target, "requirements.txt");
  if (!existsSync(requirements)) {
    throw new Error(`pip dependency path must contain requirements.txt: ${spec.path}`);
  }
  return {
    program: spec.manager,
    args: ["install", "-r", requirements, "--target", join(target, ".opendock", "python")],
  };
}

function runDependencyCommand(
  cwd: string,
  command: DependencyCommand,
  spec: DependencySpec,
  context: DependencyContext,
  dependencyName: string,
): void {
  const pathValue = prependPathEntries(
    opendockCommandPath(),
    projectCommandPathEntries(context.projectDir),
  );
  const result = spawnSync(command.program, command.args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: pathValue,
    },
    killSignal: "SIGTERM",
    stdio: (context.live ?? true) ? "inherit" : "pipe",
    timeout: spec.timeout_ms ?? defaultDependencyTimeoutMs,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      throw new Error(
        `dependency \`${dependencyName}\` install timed out after ${
          spec.timeout_ms ?? defaultDependencyTimeoutMs
        }ms`,
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(`dependency \`${dependencyName}\` install failed${text ? `: ${text}` : ""}`);
  }
}

function removeDependencyOutputsForRecord(
  projectDir: string,
  dependency: {
    manager: DependencySpec["manager"] | string;
    path: string;
  },
): void {
  const normalized = assertSafeDependencyPath(dependency.path, "installed dependency path");
  assertRealDirectoryPath(projectDir, normalized, "installed dependency path");
  const path = safeJoin(projectDir, normalized, "installed dependency path");
  removeOutputPaths(projectDir, path, dependency.manager);
}

function removeDependencyOutputsForSpec(
  projectDir: string,
  path: string,
  spec: DependencySpec,
): void {
  const target = resolveDependencyPath(projectDir, path);
  removeOutputPaths(projectDir, target, spec.manager);
}

function removeOutputPaths(projectDir: string, dependencyPath: string, manager: string): void {
  for (const output of outputPathsForManager(dependencyPath, manager)) {
    rmSync(output, { force: true, recursive: true });
    pruneEmptyDirectoryChain(projectDir, relative(projectDir, output));
  }
  pruneEmptyDirectoryChain(projectDir, relative(projectDir, dependencyPath));
}

function dependencyOutputPaths(target: string, spec: DependencySpec): string[] {
  return outputPathsForManager(target, spec.manager);
}

function outputPathsForManager(target: string, manager: string): string[] {
  if (manager === "uv") {
    return [join(target, ".venv")];
  }
  if (manager === "pip" || manager === "pip3") {
    return [join(target, ".opendock", "python")];
  }
  return [join(target, "node_modules")];
}
