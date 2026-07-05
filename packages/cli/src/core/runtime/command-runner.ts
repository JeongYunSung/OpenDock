import { spawnSync } from "node:child_process";
import { delimiter, dirname, join, sep } from "node:path";
import { detectPlatform, type OpenDockPlatform } from "../../platform.js";
import { ensureAllowed, rejectShellMetacharacters, splitCommand } from "./command-policy.js";
import { prependPathEntries } from "./project-layout.js";

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface CommandRunOptions {
  cwd: string;
  live?: boolean;
  missingAsFailure?: boolean;
  pathEntries?: string[];
  permissions?: string[];
  permissionPrograms?: string[];
  platform?: OpenDockPlatform;
  timeoutMs?: number;
}

export class CommandRunner {
  run(command: string, options: CommandRunOptions): CommandResult {
    rejectShellMetacharacters(command);
    const args = splitCommand(command);
    const [program, ...rest] = args;
    if (!program) {
      throw new Error(`empty command: ${command}`);
    }

    const platform = options.platform ?? detectPlatform();
    ensureAllowed(
      program,
      rest,
      platform,
      options.permissions ?? [],
      options.permissionPrograms ?? [],
    );

    const output = spawnSync(program, rest, {
      cwd: options.cwd,
      encoding: "utf8",
      env: commandEnvironment(program, options.pathEntries ?? [], options.permissionPrograms ?? []),
      killSignal: "SIGTERM",
      stdio: options.live ? "inherit" : "pipe",
      timeout: options.timeoutMs,
    });

    if (output.error) {
      const code = (output.error as NodeJS.ErrnoException).code;
      if (code === "ETIMEDOUT") {
        return {
          success: false,
          stdout: output.stdout ?? "",
          stderr: `timed out after ${options.timeoutMs}ms`,
        };
      }
      if (options.missingAsFailure && code === "ENOENT") {
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
}

export function combinedOutput(output: { stdout: string; stderr: string }): string {
  return `${output.stdout}\n${output.stderr}`;
}

export function failureMessage(output: CommandResult): string | undefined {
  const text = combinedOutput(output).trim();
  if (text === "") {
    return undefined;
  }
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

export function extractVersion(output: string): string | undefined {
  return output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0];
}

export function satisfiesVersion(actual: string, range: string): boolean {
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

function commandEnvironment(
  program: string,
  pathEntries: string[],
  projectPathPrograms: string[],
): NodeJS.ProcessEnv {
  const env = minimalEnvironment();
  delete env._VOLTA_TOOL_RECURSION;
  const projectPathEntries = projectPathPrograms.includes(program) ? pathEntries : [];
  env.PATH = prependPathEntries(opendockCommandPath(env.PATH), projectPathEntries);
  if (program === "oma") {
    env.OMA_SKIP_VERSION_CHECK = env.OMA_SKIP_VERSION_CHECK ?? "1";
    env.PATH = withoutVoltaNodeImageBin(env.PATH);
  }
  return env;
}

export function opendockCommandPath(
  pathValue = process.env.PATH,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const existingEntries = pathValue ? pathValue.split(pathDelimiter(platform)) : [];
  if (platform === "win32") {
    return uniquePathEntries([...existingEntries, ...windowsSystemPathEntries(env)]).join(";");
  }

  if (platform === "darwin") {
    return uniquePathEntries([
      ...macosUserPathEntries(existingEntries),
      ...macosCommonToolPathEntries,
      ...macosSystemPathEntries,
      ...(env.HOME ? [join(env.HOME, ".bun", "bin"), join(env.HOME, ".local", "bin")] : []),
      ...(env.BUN_INSTALL ? [join(env.BUN_INSTALL, "bin")] : []),
    ]).join(delimiter);
  }

  return uniquePathEntries([
    ...existingEntries,
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    ...(env.HOME ? [join(env.HOME, ".bun", "bin"), join(env.HOME, ".local", "bin")] : []),
    ...(env.BUN_INSTALL ? [join(env.BUN_INSTALL, "bin")] : []),
  ]).join(delimiter);
}

const macosCommonToolPathEntries = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
];

const macosSystemPathEntries = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : delimiter;
}

function windowsSystemPathEntries(env: NodeJS.ProcessEnv): string[] {
  const windowsRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
  return [
    windowsPath(windowsRoot, "System32"),
    windowsPath(windowsRoot, "System32", "WindowsPowerShell", "v1.0"),
    windowsPath(windowsRoot, "SysWOW64"),
    ...(env.ProgramFiles ? [windowsPath(env.ProgramFiles, "PowerShell", "7")] : []),
    ...(env["ProgramFiles(x86)"] ? [windowsPath(env["ProgramFiles(x86)"], "PowerShell", "7")] : []),
  ];
}

function windowsPath(root: string, ...parts: string[]): string {
  return [root.replace(/[\\/]+$/, ""), ...parts].join("\\");
}

function macosUserPathEntries(entries: string[]): string[] {
  const managed = new Set([...macosCommonToolPathEntries, ...macosSystemPathEntries]);
  return entries.filter((entry) => !managed.has(entry));
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "BUN_INSTALL",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TERM",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramData",
    "WINDIR",
  ]) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function uniquePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (entry === "" || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function withoutVoltaNodeImageBin(pathValue: string | undefined): string | undefined {
  if (!pathValue) {
    return pathValue;
  }

  const nodeBin = dirname(process.execPath);
  const voltaNodeImageMarker = `${sep}.volta${sep}tools${sep}image${sep}node${sep}`;
  if (!nodeBin.includes(voltaNodeImageMarker)) {
    return pathValue;
  }

  return pathValue
    .split(delimiter)
    .filter((entry) => entry !== nodeBin)
    .join(delimiter);
}
