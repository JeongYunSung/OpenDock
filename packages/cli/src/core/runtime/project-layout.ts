import { delimiter, join, relative } from "node:path";
import { safeDockDirectoryName } from "../files/path-utils.js";

export function projectBinDir(projectDir: string): string {
  return join(projectDir, ".opendock", "bin");
}

export function projectToolchainsDir(projectDir: string): string {
  return join(projectDir, ".opendock", "toolchains");
}

export function runtimeBinDir(projectDir: string, runtime: string, version: string): string {
  return join(projectToolchainsDir(projectDir), runtime, version, "bin");
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
