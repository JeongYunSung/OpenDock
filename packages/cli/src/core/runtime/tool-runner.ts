import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OpenDockPlatform } from "../../platform.js";
import type { DockManifest, TaskPhase, ToolSpec } from "../domain/manifest.js";
import { ensureRealDirectoryPath } from "../files/path-utils.js";
import { CommandRunner, failureMessage, opendockCommandPath } from "./command-runner.js";
import { createProjectCommandShim } from "./command-shim.js";
import { resolveProgramFromPath, spawnOpenDockCommand } from "./process-spawn.js";
import { type ProgressReporter, reportProgress } from "./progress.js";
import {
  prependPathEntries,
  projectBinDir,
  projectCommandPathEntries,
  relativeProjectPath,
  toolInstallDir,
} from "./project-layout.js";
import { type StepReport, stepProgressPercent } from "./step-report.js";

export interface ToolRecord {
  name: string;
  manager: ToolSpec["manager"];
  package: string;
  version: string;
  commands: string[];
  path: string;
}

interface ToolContext {
  dockId: string;
  live?: boolean;
  phase: TaskPhase;
  platform: OpenDockPlatform;
  progress?: ProgressReporter;
  projectDir: string;
}

export interface ToolRunResult {
  reports: StepReport[];
  tools: ToolRecord[];
}

export class ToolRunner {
  constructor(private readonly commandRunner = new CommandRunner()) {}

  run(manifest: DockManifest, context: ToolContext): ToolRunResult {
    const entries = Object.entries(manifest.tools ?? {});
    const reports: StepReport[] = [];
    const tools: ToolRecord[] = [];

    for (const [index, [name, spec]] of entries.entries()) {
      const current = index + 1;
      const total = entries.length;
      const result: { report: StepReport; tool?: ToolRecord } =
        context.phase === "doctor"
          ? this.checkTool(name, spec, context, current, total)
          : this.installTool(name, spec, context, current, total);
      reports.push(result.report);
      if (result.tool) {
        tools.push(result.tool);
      }
    }

    return { reports, tools };
  }

  private checkTool(
    name: string,
    spec: ToolSpec,
    context: ToolContext,
    current: number,
    total: number,
  ): { report: StepReport } {
    const id = `require-tool-${name}`;
    this.progress(context, id, `Checking tool ${name}`, "tool-check", current, total, 0.2);
    const command = spec.commands[0];
    const result = this.commandRunner.run(`${command} --version`, {
      cwd: context.projectDir,
      missingAsFailure: true,
      pathEntries: projectCommandPathEntries(context.projectDir),
      platform: context.platform,
      permissions: toolVersionPermissions(spec),
      permissionPrograms: spec.commands,
    });
    if (!result.success) {
      return {
        report: {
          id,
          name,
          status: "Failed",
          message: failureMessage(result) ?? "tool is missing",
        },
      };
    }
    return { report: { id, name, status: "Ready" } };
  }

  private installTool(
    name: string,
    spec: ToolSpec,
    context: ToolContext,
    current: number,
    total: number,
  ): { report: StepReport; tool: ToolRecord } {
    const id = `require-tool-${name}`;
    this.progress(context, id, `Installing tool ${name}`, "tool-install", current, total, 0.3);
    const installDir = toolInstallDir(context.projectDir, context.dockId, name);
    ensureRealDirectoryPath(
      context.projectDir,
      relativeProjectPath(context.projectDir, installDir),
      "tool install directory",
    );
    prepareToolPackage(installDir, spec);
    runPackageInstall(installDir, spec, context);
    for (const command of spec.commands) {
      const target = resolveInstalledCommand(installDir, spec, command, context.platform);
      createProjectCommandShim({
        command,
        owner: { dockId: context.dockId, kind: "tool", name },
        pathEntries: projectCommandPathEntries(context.projectDir),
        platform: context.platform,
        projectDir: context.projectDir,
        target,
      });
    }
    console.log(`✓ ${id}: ready`);
    this.progress(context, id, `${name} tool is ready`, "tool-ready", current, total, 0.9, "OK");
    return {
      report: { id, name, status: "Ready" },
      tool: {
        name,
        manager: spec.manager,
        package: spec.package,
        version: spec.version,
        commands: spec.commands,
        path: relativeProjectPath(context.projectDir, installDir),
      },
    };
  }

  private progress(
    context: ToolContext,
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

export function toolCommandPermissions(manifest: DockManifest): string[] {
  return Object.values(manifest.tools ?? {}).flatMap(toolVersionPermissions);
}

function toolVersionPermissions(spec: ToolSpec): string[] {
  return spec.commands.flatMap((command) => [
    `${command} --version`,
    `${command} -v`,
    `${command} -V`,
  ]);
}

function prepareToolPackage(installDir: string, spec: ToolSpec): void {
  if (["npm", "bun", "pnpm"].includes(spec.manager)) {
    writeFileSync(
      join(installDir, "package.json"),
      JSON.stringify({ private: true, dependencies: {} }, null, 2),
    );
  }
}

function runPackageInstall(installDir: string, spec: ToolSpec, context: ToolContext): void {
  const packageSpec = packageSpecifier(spec);
  if (spec.manager === "pip" || spec.manager === "pip3") {
    runPythonPackageInstall(installDir, spec, spec.manager, packageSpec, context);
    return;
  }
  if (spec.manager === "uv") {
    runUvToolInstall(installDir, spec, packageSpec, context);
    return;
  }
  const [program, args] =
    spec.manager === "npm"
      ? ["npm", ["install", "--no-audit", "--no-fund", "--save-exact", packageSpec]]
      : spec.manager === "bun"
        ? ["bun", ["add", packageSpec]]
        : ["pnpm", ["add", packageSpec]];
  runPackageCommand(program, args, installDir, context, spec.package);
}

function runUvToolInstall(
  installDir: string,
  spec: ToolSpec,
  packageSpec: string,
  context: ToolContext,
): void {
  runPackageCommand(
    "uv",
    ["tool", "install", "--force", packageSpec],
    installDir,
    context,
    spec.package,
    {
      UV_TOOL_BIN_DIR: join(installDir, "bin"),
      UV_TOOL_DIR: join(installDir, "tools"),
    },
  );
}

function runPythonPackageInstall(
  installDir: string,
  spec: ToolSpec,
  manager: "pip" | "pip3",
  packageSpec: string,
  context: ToolContext,
): void {
  if (!hasManagedPythonCommand(context.projectDir, manager)) {
    runPackageCommand(
      manager,
      ["install", "--target", join(installDir, "python"), packageSpec],
      installDir,
      context,
      spec.package,
    );
    return;
  }
  const pythonCommand = manager === "pip3" ? "python3" : "python";
  runPackageCommand(
    pythonCommand,
    ["-m", "ensurepip", "--upgrade"],
    installDir,
    context,
    spec.package,
  );
  runPackageCommand(
    pythonCommand,
    ["-m", "pip", "install", "--target", join(installDir, "python"), packageSpec],
    installDir,
    context,
    spec.package,
  );
}

function hasManagedPythonCommand(projectDir: string, manager: "pip" | "pip3"): boolean {
  const command = manager === "pip3" ? "python3" : "python";
  const bin = projectBinDir(projectDir);
  return existsSync(join(bin, command)) || existsSync(join(bin, `${command}.cmd`));
}

function runPackageCommand(
  program: string,
  args: string[],
  installDir: string,
  context: ToolContext,
  packageName: string,
  extraEnv: NodeJS.ProcessEnv = {},
): void {
  const pathValue = prependPathEntries(
    opendockCommandPath(),
    projectCommandPathEntries(context.projectDir),
  );
  const resolvedProgram = resolveProgramFromPath(program, pathValue, context.platform);
  const result = spawnOpenDockCommand(
    resolvedProgram,
    args,
    {
      cwd: installDir,
      encoding: "utf8",
      env: {
        ...process.env,
        ...extraEnv,
        PATH: pathValue,
      },
      stdio: (context.live ?? true) ? "inherit" : "pipe",
    },
    context.platform,
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(`tool \`${packageName}\` install failed${text ? `: ${text}` : ""}`);
  }
}

function packageSpecifier(spec: ToolSpec): string {
  if (spec.version === "latest") {
    return spec.manager === "uv" ? spec.package : `${spec.package}@latest`;
  }
  if (spec.manager === "pip" || spec.manager === "pip3" || spec.manager === "uv") {
    return `${spec.package}==${spec.version}`;
  }
  return `${spec.package}@${spec.version}`;
}

function resolveInstalledCommand(
  installDir: string,
  spec: ToolSpec,
  command: string,
  platform: OpenDockPlatform,
): string {
  const candidates =
    spec.manager === "pip" || spec.manager === "pip3"
      ? [
          join(installDir, "python", "bin", command),
          join(installDir, "python", "Scripts", `${command}.exe`),
          join(installDir, "python", "Scripts", `${command}.cmd`),
        ]
      : spec.manager === "uv"
        ? [
            join(installDir, "bin", command),
            join(installDir, "bin", `${command}.exe`),
            join(installDir, "bin", `${command}.cmd`),
          ]
        : [
            join(installDir, "node_modules", ".bin", command),
            join(installDir, "node_modules", ".bin", `${command}.cmd`),
          ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) {
    if (spec.manager === "pip" || spec.manager === "pip3") {
      return createPythonToolWrapper(installDir, command, found, platform);
    }
    return found;
  }
  throw new Error(
    `tool \`${spec.package}\` did not provide command \`${command}\`; check tools.commands`,
  );
}

function createPythonToolWrapper(
  installDir: string,
  command: string,
  target: string,
  platform: OpenDockPlatform,
): string {
  const wrapperDir = join(installDir, ".opendock-command-wrappers");
  mkdirSync(wrapperDir, { recursive: true });
  const packagePath = join(installDir, "python");
  if (platform === "windows") {
    const wrapper = join(wrapperDir, `${command}.cmd`);
    writeFileSync(
      wrapper,
      `@echo off\r\nset "PYTHONPATH=${packagePath};%PYTHONPATH%"\r\n"${target}" %*\r\n`,
    );
    return wrapper;
  }
  const wrapper = join(wrapperDir, command);
  writeFileSync(
    wrapper,
    `#!/usr/bin/env sh
PYTHONPATH=${shQuote(packagePath)}\${PYTHONPATH:+:\${PYTHONPATH}}
export PYTHONPATH
exec ${shQuote(target)} "$@"
`,
  );
  chmodSync(wrapper, 0o755);
  return wrapper;
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
