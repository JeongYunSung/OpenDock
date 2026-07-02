import type { OpenDockPlatform } from "../../platform.js";
import { includesShellOperator } from "../domain/shell-operators.js";

const safePackagePattern =
  /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+(?:@[A-Za-z0-9][A-Za-z0-9._+-]*)?$/;
const safeIdentifierPattern = /^[A-Za-z0-9._:@/=-]+$/;
const powershellTestPathPattern =
  /^if \(Test-Path -LiteralPath ([A-Za-z0-9._/@-]+)\) \{ exit 0 \} else \{ exit 1 \}$/;
const blockedPackageRunnerFlags = new Set(["--package", "-p", "--eval", "-e", "--call", "-c"]);
const packageManagerMutations = new Set(["add", "install", "update", "upgrade"]);

const commonAllowedCommands = new Set([
  "bun",
  "bunx",
  "git",
  "node",
  "npm",
  "npx",
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
  windows: new Set(["powershell", "winget"]),
};

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

export function rejectShellMetacharacters(command: string): void {
  if (includesShellOperator(command)) {
    throw new Error(`shell operators are not allowed in OpenDock commands: ${command}`);
  }
}

export function isDefaultCommandProgram(program: string, platform: OpenDockPlatform): boolean {
  return commonAllowedCommands.has(program) || platformAllowedCommands[platform].has(program);
}

export function ensureAllowed(
  program: string,
  args: string[],
  platform: OpenDockPlatform,
  permissions: string[],
  permissionPrograms: string[] = [],
): void {
  const blockedReason = blockedCommandReason(program, args);
  if (blockedReason) {
    throw new Error(blockedReason);
  }
  if (isPermissionAllowed(program, args, permissions)) {
    if (isDefaultCommandProgram(program, platform) || permissionPrograms.includes(program)) {
      return;
    }
    throw new Error(
      `command \`${program}\` is not declared in tools.commands and is not an OpenDock default command`,
    );
  }
  if (!isDefaultCommandProgram(program, platform)) {
    throw new Error(
      `command \`${program}\` is not allowed for OpenDock platform \`${platform}\` commands`,
    );
  }
  if (!isAllowedCommandShape(program, args)) {
    const rendered = [program, ...args].join(" ");
    throw new Error(`command \`${rendered}\` is not allowed for OpenDock commands`);
  }
}

function isPermissionAllowed(program: string, args: string[], permissions: string[]): boolean {
  for (const permission of permissions) {
    const parts = splitCommand(permission);
    if (parts.length === 0) {
      continue;
    }
    if (parts[0] !== program) {
      continue;
    }
    const permissionArgs = parts.slice(1);
    if (isExact(args, permissionArgs)) {
      return true;
    }
  }
  return false;
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
  if (program === "brew") {
    return isExact(args, ["--version"]);
  }
  if (program === "winget") {
    return isExact(args, ["--version"]);
  }
  if (program === "powershell") {
    return isSafePowershellCommand(args);
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
  return false;
}

function isSafePackageManagerCommand(_program: string, args: string[]): boolean {
  if (isExact(args, ["--version"])) {
    return true;
  }
  return false;
}

function isSafePipCommand(args: string[]): boolean {
  if (isExact(args, ["--version"]) || isExact(args, ["-V"])) {
    return true;
  }
  return false;
}

function isSafePipxCommand(args: string[]): boolean {
  if (isExact(args, ["--version"])) {
    return true;
  }
  return false;
}

function isSafeUvCommand(args: string[]): boolean {
  if (isExact(args, ["--version"])) {
    return true;
  }
  return false;
}

function isSafePackageRunnerCommand(args: string[]): boolean {
  if (args.length === 0 || !isSafePackageName(args[0] ?? "")) {
    return false;
  }
  return args.slice(1).every((arg) => !blockedPackageRunnerFlags.has(arg) && isSafeRunnerArg(arg));
}

function isSafePowershellCommand(args: string[]): boolean {
  if (
    args.length !== 4 ||
    args[0] !== "-NoProfile" ||
    args[1] !== "-NonInteractive" ||
    args[2] !== "-Command"
  ) {
    return false;
  }
  const match = args[3]?.match(powershellTestPathPattern);
  return !!match && isSafeRelativeArg(match[1]);
}

function blockedCommandReason(program: string, args: string[]): string | undefined {
  if (
    (program === "npm" || program === "bun" || program === "pnpm") &&
    packageManagerMutations.has(args[0] ?? "")
  ) {
    return "package installs and updates are not allowed in dock task commands; declare project-local `tools` instead";
  }
  if ((program === "pip" || program === "pip3") && args[0] === "install") {
    return "package installs and updates are not allowed in dock task commands; declare project-local `tools` instead";
  }
  if (program === "pipx" && ["install", "upgrade"].includes(args[0] ?? "")) {
    return "package installs and updates are not allowed in dock task commands; declare project-local `tools` instead";
  }
  if (program === "uv" && args[0] === "tool" && ["install", "upgrade"].includes(args[1] ?? "")) {
    return "package installs and updates are not allowed in dock task commands; declare project-local `tools` instead";
  }
  if (
    (program === "brew" || program === "winget") &&
    ["install", "upgrade"].includes(args[0] ?? "")
  ) {
    return "system package installs are not allowed in dock task commands; use OpenDock bootstrap or declare runtimes under `requires`";
  }
  return undefined;
}

function isExact(args: string[], expected: string[]): boolean {
  return args.length === expected.length && args.every((arg, index) => arg === expected[index]);
}

function isSafePackageName(value: string): boolean {
  return safePackagePattern.test(value) && !isLocalPackageSpec(value);
}

function isLocalPackageSpec(value: string): boolean {
  const packageName = stripPackageVersion(value);
  const unscopedName = packageName.startsWith("@")
    ? (packageName.split("/")[1] ?? "")
    : packageName;
  return (
    unscopedName === "." ||
    unscopedName === ".." ||
    unscopedName.startsWith(".") ||
    packageName.includes("\\") ||
    packageName.toLowerCase().startsWith("file:")
  );
}

function stripPackageVersion(value: string): string {
  if (value.startsWith("@")) {
    const slashIndex = value.indexOf("/");
    if (slashIndex < 0) {
      return value;
    }
    const versionIndex = value.indexOf("@", slashIndex + 1);
    return versionIndex < 0 ? value : value.slice(0, versionIndex);
  }
  const versionIndex = value.indexOf("@");
  return versionIndex < 0 ? value : value.slice(0, versionIndex);
}

function isSafeRunnerArg(value: string): boolean {
  return safeIdentifierPattern.test(value);
}

function isSafeRelativeArg(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.split(/[\\/]+/).join("/");
  return (
    normalized !== "" &&
    normalized !== "." &&
    !normalized.startsWith("/") &&
    !normalized.startsWith("../") &&
    !normalized.includes("/../") &&
    !normalized.includes("\0")
  );
}
