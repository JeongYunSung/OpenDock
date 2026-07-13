import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { OpenDockPlatform } from "../../platform.js";
import { formatStepSymbol, terminalStyle } from "../../terminal-style.js";
import type { DependencySpec, DockManifest, TaskPhase } from "../domain/manifest.js";
import {
  assertRealDirectoryPath,
  assertSafeDependencyPath,
  assertSafeRelativePath,
  pruneEmptyDirectoryChain,
  safeJoin,
} from "../files/path-utils.js";
import { opendockCommandPath } from "./command-runner.js";
import { resolveProgramFromPath, spawnOpenDockCommand } from "./process-spawn.js";
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

export interface DetachedDependencyOutput {
  backupPath: string;
  originalPath: string;
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
    try {
      verifyDependencyIntegrity(target, spec);
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
    let verifiedTarget = target;
    try {
      runDependencyCommand(target, command, spec, context, name);
      verifiedTarget = resolveDependencyPath(context.projectDir, spec.path);
      verifyDependencyIntegrity(verifiedTarget, spec);
    } catch (error) {
      try {
        removeDependencyOutputsForSpec(context.projectDir, spec.path, spec);
      } catch {
        // A dependency command can replace its root with a symlink. Never follow
        // the stale pre-install path while rolling back the original failure.
      }
      throw error;
    }
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
        path: relativeProjectPath(context.projectDir, verifiedTarget),
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

function verifyDependencyIntegrity(target: string, spec: DependencySpec): void {
  for (const integrity of spec.integrity) {
    const normalized = assertSafeRelativePath(integrity.path, "dependency integrity path");
    const parent = dirname(normalized).replaceAll("\\", "/");
    if (parent !== ".") {
      assertRealDirectoryPath(target, parent, "dependency integrity parent");
    }
    const file = safeJoin(target, normalized, "dependency integrity path");
    if (!existsSync(file)) {
      throw new Error(`missing dependency integrity file ${normalized}`);
    }
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`dependency integrity file must be a regular file: ${normalized}`);
    }
    const digest = fileSha256(file);
    if (!integrity.sha256.includes(digest)) {
      throw new Error(`dependency integrity mismatch for ${normalized}: got ${digest}`);
    }
  }
}

function fileSha256(path: string): string {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
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

export function detachInstalledDependencyOutputs(
  projectDir: string,
  dependencies: Array<{
    manager: DependencySpec["manager"] | string;
    path: string;
  }>,
  backupRoot: string,
): DetachedDependencyOutput[] {
  const detached: DetachedDependencyOutput[] = [];
  try {
    for (const dependency of dependencies) {
      const normalized = assertSafeDependencyPath(dependency.path, "installed dependency path");
      const target = resolveDependencyPath(projectDir, normalized);
      for (const output of outputPathsForManager(target, dependency.manager)) {
        if (!existsSync(output)) continue;
        const parent = relativeProjectPath(projectDir, dirname(output));
        assertRealDirectoryPath(projectDir, parent, "dependency output parent");
        const stat = lstatSync(output);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new Error(
            `dependency output must be a real directory: ${relativeProjectPath(projectDir, output)}`,
          );
        }
        const backupPath = join(backupRoot, String(detached.length));
        mkdirSync(dirname(backupPath), { recursive: true });
        renameSync(output, backupPath);
        detached.push({ backupPath, originalPath: output });
      }
    }
    return detached;
  } catch (error) {
    restoreDetachedDependencyOutputs(projectDir, detached);
    throw error;
  }
}

export function restoreDetachedDependencyOutputs(
  projectDir: string,
  detached: DetachedDependencyOutput[],
): void {
  for (const entry of [...detached].reverse()) {
    const original = relativeProjectPath(projectDir, entry.originalPath);
    const parent = relativeProjectPath(projectDir, dirname(entry.originalPath));
    assertRealDirectoryPath(projectDir, parent, "dependency restore parent");
    mkdirSync(safeJoin(projectDir, parent, "dependency restore parent"), { recursive: true });
    const target = safeJoin(projectDir, original, "dependency restore path");
    rmSync(target, { force: true, recursive: true });
    renameSync(entry.backupPath, target);
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
  const program = resolveProgramFromPath(command.program, pathValue, context.platform);
  const result = spawnOpenDockCommand(
    program,
    command.args,
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: pathValue,
      },
      killSignal: "SIGTERM",
      stdio: (context.live ?? true) ? "inherit" : "pipe",
      timeout: spec.timeout_ms ?? defaultDependencyTimeoutMs,
    },
    context.platform,
  );
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
  const dependencyRelative = relativeProjectPath(projectDir, dependencyPath);
  const verifiedDependencyPath = resolveDependencyPath(projectDir, dependencyRelative);
  for (const output of outputPathsForManager(verifiedDependencyPath, manager)) {
    const outputParent = relativeProjectPath(projectDir, dirname(output));
    assertRealDirectoryPath(projectDir, outputParent, "dependency output parent");
    rmSync(output, { force: true, recursive: true });
    pruneEmptyDirectoryChain(projectDir, relative(projectDir, output));
  }
  pruneEmptyDirectoryChain(projectDir, relative(projectDir, verifiedDependencyPath));
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
