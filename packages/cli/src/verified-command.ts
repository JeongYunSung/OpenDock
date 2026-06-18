import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { type CommandSpec, type DockManifest, DockRef } from "./core/domain/manifest.js";
import type { InstalledDockRecord } from "./core/domain/state-store.js";
import { fileChecksum } from "./core/files/checksum.js";
import {
  assertRegularOrMissing,
  assertSafeRelativePath,
  normalizeRelativePath,
  safeJoin,
} from "./core/files/path-utils.js";
import { resolveDock } from "./resolver.js";

const commandNamePattern = /^[a-z][a-z0-9-]{0,63}$/;
const runCommandTimeoutMs = 30_000;

export interface VerifiedCommandReport {
  command: string;
  dockId: string;
  file: string;
  runner: string;
  version: string;
}

interface VerifiedCommandCandidate extends VerifiedCommandReport {
  absoluteTarget: string;
  expectedChecksum: string;
  projectDir: string;
}

export async function runVerifiedCommand(
  projectDir: string,
  commandName: string,
  installedDocks: InstalledDockRecord[],
  options: { dockId?: string } = {},
): Promise<VerifiedCommandReport> {
  const command = parseRunCommandName(commandName);
  const selectedDocks =
    options.dockId === undefined
      ? installedDocks
      : installedDocks.filter((dock) => dock.id === options.dockId);
  if (options.dockId !== undefined && selectedDocks.length === 0) {
    throw new Error(`dock \`${options.dockId}\` is not installed in this project`);
  }

  const candidates: VerifiedCommandCandidate[] = [];
  for (const dock of selectedDocks) {
    const resolved = await resolveDock(DockRef.parse(`${dock.id}@${dock.version}`), dock.platform);
    assertResolvedReleaseMatchesLock(dock, resolved.checksum, resolved.signature);
    const spec = resolved.manifest.commands[command];
    if (!spec) {
      continue;
    }
    candidates.push(resolveVerifiedCommandCandidate(projectDir, dock, resolved, command, spec));
  }

  if (candidates.length === 0) {
    const suffix = options.dockId === undefined ? "" : ` in dock \`${options.dockId}\``;
    throw new Error(`command \`${command}\` is not installed${suffix}`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `command \`${command}\` is declared by multiple docks: ${candidates
        .map((candidate) => candidate.dockId)
        .join(", ")}. Use --dock owner/name.`,
    );
  }

  const candidate = candidates[0];
  if (candidate === undefined) {
    throw new Error(`command \`${command}\` is not installed`);
  }
  runVerifiedCommandCandidate(candidate);
  return {
    command: candidate.command,
    dockId: candidate.dockId,
    file: candidate.file,
    runner: candidate.runner,
    version: candidate.version,
  };
}

export function parseRunCommandName(value: string): string {
  const command = value.trim();
  if (!commandNamePattern.test(command)) {
    throw new Error("command name must be a lowercase slug declared by an installed dock");
  }
  return command;
}

function assertResolvedReleaseMatchesLock(
  dock: InstalledDockRecord,
  checksum: string,
  signature: string,
): void {
  if (dock.checksum !== checksum) {
    throw new Error(`release checksum mismatch for installed dock \`${dock.id}@${dock.version}\``);
  }
  if (dock.signature !== signature) {
    throw new Error(`release signature mismatch for installed dock \`${dock.id}@${dock.version}\``);
  }
}

function resolveVerifiedCommandCandidate(
  projectDir: string,
  dock: InstalledDockRecord,
  resolved: Awaited<ReturnType<typeof resolveDock>>,
  command: string,
  spec: CommandSpec,
): VerifiedCommandCandidate {
  const file = assertSafeRelativePath(spec.file, "command file");
  assertCommandRunnerMatchesFile(spec.runner, file);
  const source = resolveCommandSource(resolved.manifest, file);
  const sourcePath = safeJoin(resolved.root, source, "command source");
  assertRegularOrMissing(sourcePath, source);
  if (!existsSync(sourcePath)) {
    throw new Error(`command source missing in signed release: ${source}`);
  }

  const expectedChecksum = fileChecksum(sourcePath);
  const record = dock.files.find((installedFile) => installedFile.path === file);
  if (!record) {
    throw new Error(`command file is not recorded in lock: ${file}`);
  }
  if (record.mode !== "managed_file") {
    throw new Error(`command file must be checksum-managed: ${file}`);
  }
  if (record.source !== "files") {
    throw new Error(`command file must come from signed manifest files: ${file}`);
  }
  if (record.checksum !== expectedChecksum) {
    throw new Error(`lock checksum does not match signed release for command file: ${file}`);
  }

  const absoluteTarget = safeJoin(projectDir, file, "command target");
  assertRegularOrMissing(absoluteTarget, file);
  if (!existsSync(absoluteTarget)) {
    throw new Error(`command file missing: ${file}`);
  }
  if (fileChecksum(absoluteTarget) !== expectedChecksum) {
    throw new Error(`checksum mismatch for command file ${file}`);
  }

  return {
    absoluteTarget,
    command,
    dockId: dock.id,
    expectedChecksum,
    file,
    projectDir,
    runner: spec.runner,
    version: dock.version,
  };
}

export function resolveCommandSource(manifest: DockManifest, commandFile: string): string {
  for (const mapping of manifest.files) {
    const from = normalizeRelativePath(mapping.from);
    const to = normalizeRelativePath(mapping.to);
    if (commandFile === to) {
      return assertSafeRelativePath(from, "command source");
    }
    if (commandFile.startsWith(`${to}/`)) {
      const suffix = commandFile.slice(to.length + 1);
      return assertSafeRelativePath(`${from}/${suffix}`, "command source");
    }
  }
  throw new Error(`command file must be installed through manifest files: ${commandFile}`);
}

export function assertCommandRunnerMatchesFile(runner: string, file: string): void {
  const extension = extname(file).toLowerCase();
  const allowedExtensions: Record<string, string[]> = {
    bun: [".cjs", ".js", ".mjs", ".ts"],
    node: [".cjs", ".js", ".mjs"],
    powershell: [".ps1"],
    python: [".py"],
    python3: [".py"],
    sh: [".sh"],
  };
  if (!allowedExtensions[runner]?.includes(extension)) {
    throw new Error(
      `command runner \`${runner}\` is not allowed for ${extension || "extensionless"} files`,
    );
  }
}

function runVerifiedCommandCandidate(candidate: VerifiedCommandCandidate): void {
  const { args, program } = commandInvocation(candidate.runner, candidate.absoluteTarget);
  const result = spawnSync(program, args, {
    cwd: candidate.projectDir,
    env: runCommandEnvironment(),
    stdio: "inherit",
    timeout: runCommandTimeoutMs,
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`command \`${candidate.command}\` terminated by ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(`command \`${candidate.command}\` failed with exit code ${result.status ?? 1}`);
  }
}

function commandInvocation(runner: string, file: string): { args: string[]; program: string } {
  if (runner === "powershell") {
    return {
      program: "powershell",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file],
    };
  }
  return { program: runner, args: [file] };
}

function runCommandEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "CI",
    "ComSpec",
    "COMSPEC",
    "FORCE_COLOR",
    "HOME",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
    "USERNAME",
    "WINDIR",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
