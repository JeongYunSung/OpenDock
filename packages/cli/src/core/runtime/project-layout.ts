import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { safeDockDirectoryName } from "../files/path-utils.js";

export function projectBinDir(projectDir: string): string {
  return join(projectDir, ".opendock", "bin");
}

export function sharedRuntimeRoot(): string {
  return join(realpathSync(process.env.HOME ?? homedir()), ".opendock", "runtimes");
}

export function sharedRuntimeBinDir(runtime: string, version: string): string {
  return join(sharedRuntimeRoot(), safeRuntimeSegment(runtime), safeRuntimeSegment(version), "bin");
}

export function projectToolsDir(projectDir: string): string {
  return join(projectDir, ".opendock", "tools");
}

export function dockToolsDir(projectDir: string, dockId: string): string {
  return join(projectToolsDir(projectDir), safeDockDirectoryName(dockId));
}

export function toolInstallDir(projectDir: string, dockId: string, toolName: string): string {
  return join(dockToolsDir(projectDir, dockId), toolName);
}

export function projectCommandPathEntries(projectDir: string): string[] {
  return [projectBinDir(projectDir)];
}

export function prependPathEntries(pathValue: string | undefined, entries: string[]): string {
  const existingEntries = pathValue ? pathValue.split(delimiter) : [];
  return uniquePathEntries([...entries, ...existingEntries]).join(delimiter);
}

export function relativeProjectPath(projectDir: string, path: string): string {
  return relative(projectDir, path).replaceAll("\\", "/");
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

function safeRuntimeSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._+-]/g, "_");
}
