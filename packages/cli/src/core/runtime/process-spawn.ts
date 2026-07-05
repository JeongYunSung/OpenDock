import {
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
  spawnSync,
} from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { OpenDockPlatform } from "../../platform.js";

export function resolveProgramFromPath(
  program: string,
  pathValue: string | undefined,
  platform: OpenDockPlatform,
): string {
  if (hasPathSeparator(program) || !pathValue) {
    return program;
  }
  for (const entry of pathValue.split(pathDelimiter(platform))) {
    if (!entry) {
      continue;
    }
    for (const candidate of programCandidates(entry, program, platform)) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return program;
}

export function spawnOpenDockCommand(
  program: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
  platform: OpenDockPlatform,
): SpawnSyncReturns<string> {
  if (platform === "windows" && isWindowsBatchFile(program)) {
    return spawnSync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", windowsCommandLine(program, args)],
      options,
    );
  }
  return spawnSync(program, args, options);
}

function programCandidates(
  directory: string,
  program: string,
  platform: OpenDockPlatform,
): string[] {
  if (platform === "windows") {
    return [`${program}.cmd`, `${program}.exe`, `${program}.bat`, program].map((name) =>
      join(directory, name),
    );
  }
  return [join(directory, program)];
}

function pathDelimiter(platform: OpenDockPlatform): string {
  return platform === "windows" ? ";" : delimiter;
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function isWindowsBatchFile(value: string): boolean {
  return /\.(?:cmd|bat)$/iu.test(value);
}

function windowsCommandLine(program: string, args: string[]): string {
  return [program, ...args].map(windowsCommandArg).join(" ");
}

function windowsCommandArg(value: string): string {
  return `"${value.replaceAll("%", "%%").replaceAll('"', '\\"')}"`;
}
