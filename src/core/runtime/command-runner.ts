import { spawnSync } from "node:child_process";
import { delimiter, dirname, sep } from "node:path";
import { detectPlatform, type OpenDockPlatform } from "../../platform.js";

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface CommandRunOptions {
  cwd: string;
  live?: boolean;
  missingAsFailure?: boolean;
  platform?: OpenDockPlatform;
  timeoutMs?: number;
}

const safePackagePattern =
  /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+(?:@[A-Za-z0-9][A-Za-z0-9._+-]*)?$/;
const safeIdentifierPattern = /^[A-Za-z0-9._:@/=-]+$/;

const commonAllowedCommands = new Set([
  "bun",
  "bunx",
  "claude",
  "codex",
  "git",
  "mkdir",
  "node",
  "npm",
  "npx",
  "oma",
  "omx",
  "pip",
  "pip3",
  "pipx",
  "pnpm",
  "python",
  "python3",
  "test",
  "uv",
]);

const platformAllowedCommands: Record<OpenDockPlatform, Set<string>> = {
  linux: new Set([]),
  macos: new Set(["brew"]),
  windows: new Set(["winget"]),
};

export class CommandRunner {
  run(command: string, options: CommandRunOptions): CommandResult {
    rejectShellMetacharacters(command);
    const args = splitCommand(command);
    const [program, ...rest] = args;
    if (!program) {
      throw new Error(`empty command: ${command}`);
    }

    const platform = options.platform ?? detectPlatform();
    ensureAllowed(program, rest, platform);

    const output = spawnSync(program, rest, {
      cwd: options.cwd,
      encoding: "utf8",
      env: commandEnvironment(program),
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

export function splitCommand(command: string): string[] {
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

function commandEnvironment(program: string): NodeJS.ProcessEnv {
  const env = minimalEnvironment();
  delete env._VOLTA_TOOL_RECURSION;
  if (program === "oma") {
    env.OMA_SKIP_VERSION_CHECK = env.OMA_SKIP_VERSION_CHECK ?? "1";
    env.PATH = withoutVoltaNodeImageBin(env.PATH);
  }
  return env;
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

function rejectShellMetacharacters(command: string): void {
  const blocked = ["|", "&&", "||", ";", "`", "$(", ">", "<"];
  if (blocked.some((token) => command.includes(token))) {
    throw new Error(`shell operators are not allowed in OpenDock commands: ${command}`);
  }
}

function ensureAllowed(program: string, args: string[], platform: OpenDockPlatform): void {
  if (!commonAllowedCommands.has(program) && !platformAllowedCommands[platform].has(program)) {
    throw new Error(
      `command \`${program}\` is not allowed for OpenDock platform \`${platform}\` commands`,
    );
  }
  if (!isAllowedCommandShape(program, args)) {
    const rendered = [program, ...args].join(" ");
    throw new Error(`command \`${rendered}\` is not allowed for OpenDock commands`);
  }
}

function isAllowedCommandShape(program: string, args: string[]): boolean {
  if (program === "node" || program === "python" || program === "python3") {
    return args.length === 1 && ["--version", "-v", "-V"].includes(args[0] ?? "");
  }
  if (program === "git") {
    return (
      isExact(args, ["--version"]) ||
      isExact(args, ["status"]) ||
      isExact(args, ["init", "-b", "main"])
    );
  }
  if (program === "test") {
    return args.length === 2 && ["-d", "-f"].includes(args[0] ?? "") && isSafeRelativeArg(args[1]);
  }
  if (program === "mkdir") {
    const paths = args[0] === "-p" ? args.slice(1) : args;
    return paths.length > 0 && paths.every(isSafeRelativeArg);
  }
  if (program === "brew") {
    return (
      isExact(args, ["--version"]) ||
      (["install", "upgrade"].includes(args[0] ?? "") && args.slice(1).every(isSafePackageName))
    );
  }
  if (program === "winget") {
    return isSafeWingetCommand(args);
  }
  if (program === "npm" || program === "pnpm" || program === "bun") {
    return isSafePackageManagerCommand(program, args);
  }
  if (program === "pip" || program === "pip3") {
    return isSafePipCommand(args);
  }
  if (program === "pipx") {
    return isSafePipxCommand(args);
  }
  if (program === "uv") {
    return isSafeUvCommand(args);
  }
  if (program === "npx" || program === "bunx") {
    return isSafePackageRunnerCommand(args);
  }
  if (program === "codex" || program === "claude") {
    return isExact(args, ["--version"]);
  }
  if (program === "oma") {
    return isSafeOmaCommand(args);
  }
  if (program === "omx") {
    return isSafeOmxCommand(args);
  }
  return false;
}

function isSafePackageManagerCommand(program: string, args: string[]): boolean {
  if (isExact(args, ["--version"])) {
    return true;
  }
  if (program === "pnpm" && args[0] === "add") {
    return hasGlobalFlag(args) && packageArgs(args.slice(1)).every(isSafePackageName);
  }
  if ((args[0] === "install" || args[0] === "update") && hasGlobalFlag(args)) {
    return packageArgs(args.slice(1)).every(isSafePackageName);
  }
  return false;
}

function isSafePipCommand(args: string[]): boolean {
  if (isExact(args, ["--version"]) || isExact(args, ["-V"])) {
    return true;
  }
  if (args[0] !== "install") {
    return false;
  }
  const allowedFlags = new Set(["--user", "--upgrade", "-U"]);
  const packages = args.slice(1).filter((arg) => !allowedFlags.has(arg));
  return packages.length > 0 && packages.every(isSafePackageName);
}

function isSafePipxCommand(args: string[]): boolean {
  if (isExact(args, ["--version"])) {
    return true;
  }
  return (
    ["install", "upgrade"].includes(args[0] ?? "") &&
    args.length >= 2 &&
    args.slice(1).every(isSafePackageName)
  );
}

function isSafeUvCommand(args: string[]): boolean {
  if (isExact(args, ["--version"])) {
    return true;
  }
  return (
    args.length >= 3 &&
    args[0] === "tool" &&
    ["install", "upgrade"].includes(args[1] ?? "") &&
    args.slice(2).every(isSafePackageName)
  );
}

function isSafePackageRunnerCommand(args: string[]): boolean {
  if (args.length === 0 || !isSafePackageName(args[0] ?? "")) {
    return false;
  }
  const blocked = new Set(["--package", "-p", "--eval", "-e", "--call", "-c"]);
  return args.slice(1).every((arg) => !blocked.has(arg) && isSafeRunnerArg(arg));
}

function isSafeOmaCommand(args: string[]): boolean {
  if (args.length === 0) {
    return true;
  }
  if (
    isExact(args, ["--version"]) ||
    isExact(args, ["doctor"]) ||
    isExact(args, ["install"]) ||
    isExact(args, ["-y", "install"]) ||
    isExact(args, ["--yes", "install"]) ||
    isExact(args, ["-y", "update"]) ||
    isExact(args, ["--yes", "update"])
  ) {
    return true;
  }
  if (args[0] !== "update") {
    return false;
  }
  const allowed = new Set(["update", "-y", "--yes"]);
  return args.every((arg) => allowed.has(arg));
}

function isSafeOmxCommand(args: string[]): boolean {
  if (args.length === 0) {
    return true;
  }
  return (
    isExact(args, ["--version"]) ||
    isExact(args, ["setup"]) ||
    isExact(args, ["doctor"]) ||
    isExact(args, ["update"])
  );
}

function isSafeWingetCommand(args: string[]): boolean {
  if (isExact(args, ["--version"])) {
    return true;
  }
  if (!["install", "upgrade"].includes(args[0] ?? "")) {
    return false;
  }
  const idIndex = args.indexOf("--id");
  if (idIndex < 0 || !isSafePackageName(args[idIndex + 1] ?? "")) {
    return false;
  }
  const allowedFlags = new Set([
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--exact",
    "--id",
  ]);
  return args.slice(1).every((arg, index) => {
    const originalIndex = index + 1;
    if (originalIndex === idIndex) {
      return true;
    }
    if (originalIndex === idIndex + 1) {
      return isSafePackageName(arg);
    }
    return allowedFlags.has(arg);
  });
}

function hasGlobalFlag(args: string[]): boolean {
  return args.includes("--global") || args.includes("-g");
}

function packageArgs(args: string[]): string[] {
  return args.filter((arg) => arg !== "--global" && arg !== "-g");
}

function isExact(args: string[], expected: string[]): boolean {
  return args.length === expected.length && args.every((arg, index) => arg === expected[index]);
}

function isSafePackageName(value: string): boolean {
  return safePackagePattern.test(value);
}

function isSafeRunnerArg(value: string): boolean {
  return safeIdentifierPattern.test(value);
}

function isSafeRelativeArg(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.split(sep).join("/");
  return (
    normalized !== "" &&
    normalized !== "." &&
    !normalized.startsWith("/") &&
    !normalized.startsWith("../") &&
    !normalized.includes("/../") &&
    !normalized.includes("\0")
  );
}
