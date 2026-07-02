import { chmodSync, existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { OpenDockPlatform } from "../../platform.js";
import { ensureRealDirectoryPath } from "../files/path-utils.js";
import { projectBinDir } from "./project-layout.js";

const shimMarker = "OpenDock command shim";
const safeCommandNamePattern = /^[A-Za-z0-9._-]+$/;

export interface CommandShimOwner {
  dockId: string;
  kind: "runtime" | "tool";
  name: string;
}

export function createProjectCommandShim(options: {
  command: string;
  owner: CommandShimOwner;
  platform: OpenDockPlatform;
  projectDir: string;
  target: string;
}): string {
  assertSafeCommandName(options.command);
  ensureRealDirectoryPath(options.projectDir, ".opendock/bin", "OpenDock bin directory");
  const shim = join(projectBinDir(options.projectDir), options.command);
  assertShimWritable(shim, options.command, options.owner);
  writeFileSync(shim, posixShim(options.target, options.owner));
  chmodSync(shim, 0o755);

  if (options.platform === "windows") {
    const cmdShim = `${shim}.cmd`;
    assertShimWritable(cmdShim, `${options.command}.cmd`, options.owner);
    writeFileSync(cmdShim, windowsShim(options.target, options.owner));
  }
  return shim;
}

export function removeProjectCommandShim(options: {
  command: string;
  owner: CommandShimOwner;
  platform?: OpenDockPlatform;
  projectDir: string;
}): void {
  assertSafeCommandName(options.command);
  for (const path of shimPaths(options.projectDir, options.command, options.platform)) {
    if (!existsSync(path)) {
      continue;
    }
    const owner = readShimOwner(path);
    if (!owner || owner.dockId !== options.owner.dockId || owner.name !== options.owner.name) {
      continue;
    }
    rmSync(path, { force: true });
  }
}

export function assertSafeCommandName(command: string): void {
  if (
    command === "" ||
    command === "." ||
    command === ".." ||
    !safeCommandNamePattern.test(command)
  ) {
    throw new Error(`unsafe command shim name: ${command}`);
  }
}

function assertShimWritable(path: string, command: string, owner: CommandShimOwner): void {
  if (!existsSync(path)) {
    return;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`OpenDock command shim cannot be a symlink: ${command}`);
  }
  if (!stat.isFile()) {
    throw new Error(`OpenDock command shim path must be a file: ${command}`);
  }
  const existingOwner = readShimOwner(path);
  if (!existingOwner) {
    throw new Error(`command \`${command}\` already exists and is not OpenDock-managed`);
  }
  if (existingOwner.dockId !== owner.dockId || existingOwner.name !== owner.name) {
    throw new Error(
      `command \`${command}\` is already provided by ${existingOwner.kind} \`${existingOwner.name}\` from dock \`${existingOwner.dockId}\``,
    );
  }
}

function readShimOwner(path: string): CommandShimOwner | undefined {
  const content = readFileSync(path, "utf8");
  const match = content.match(/(?:# |REM )?OPENDOCK_OWNER=(.+)(?:\r?\n|$)/);
  if (!match) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(match[1] ?? "", "base64").toString("utf8")) as CommandShimOwner;
  } catch {
    return undefined;
  }
}

function shimOwnerLine(owner: CommandShimOwner): string {
  return `OPENDOCK_OWNER=${Buffer.from(JSON.stringify(owner), "utf8").toString("base64")}`;
}

function posixShim(target: string, owner: CommandShimOwner): string {
  return `#!/usr/bin/env sh
# ${shimMarker}
# ${shimOwnerLine(owner)}
exec ${shQuote(resolve(target))} "$@"
`;
}

function windowsShim(target: string, owner: CommandShimOwner): string {
  const targetPath = resolve(target);
  return `@echo off\r
REM ${shimMarker}\r
REM ${shimOwnerLine(owner)}\r
"${targetPath}" %*\r
`;
}

function shimPaths(projectDir: string, command: string, platform?: OpenDockPlatform): string[] {
  const base = join(projectBinDir(projectDir), command);
  if (platform === "windows") {
    return [base, `${base}.cmd`];
  }
  return [base, `${base}.cmd`];
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
