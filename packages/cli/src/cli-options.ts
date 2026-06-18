import { basename } from "node:path";
import { DockRef } from "./core/domain/manifest.js";
import { detectPlatform, type OpenDockPlatform, parsePlatform } from "./platform.js";
import type { AuthProvider } from "./registry.js";

const cliCommandNames = new Set([
  "auth",
  "bootstrap",
  "deploy",
  "doctor",
  "install",
  "list",
  "log",
  "outdated",
  "run",
  "uninstall",
  "update",
  "version",
]);

export function normalizeCliArgv(argv: string[]): string[] {
  const first = basename(argv[0] ?? "");
  const second = basename(argv[1] ?? "");
  if (first === "bun" || first === "node") {
    return cliCommandNames.has(argv[1] ?? "") ? argv.slice(1) : argv.slice(2);
  }
  if (first === "opendock" || second === "opendock" || second === "cli.ts") {
    return argv.slice(second === "opendock" || second === "cli.ts" ? 2 : 1);
  }
  return argv;
}

export function parseDeployRef(value: string): DockRef {
  if (!value.includes("@")) {
    throw new Error(
      "deploy reference must use owner/name@version with an exact version identifier, e.g. opendock/oma@1.0.0",
    );
  }
  return DockRef.parse(value);
}

export function deployOptionValue(
  parsedValue: string | undefined,
  argv: string[],
  optionName: "--file" | "--platform",
): string | undefined {
  const equalsPrefix = `${optionName}=`;
  for (const [index, token] of argv.entries()) {
    if (token === optionName) {
      return argv[index + 1] ?? parsedValue;
    }
    if (token.startsWith(equalsPrefix)) {
      return token.slice(equalsPrefix.length);
    }
  }
  return parsedValue;
}

export function parseInstallRef(value: string): DockRef {
  if (!value.includes("@")) {
    throw new Error(
      "install reference must use owner/name@version with an exact version identifier, e.g. opendock/codex@1.0.0",
    );
  }
  return DockRef.parse(value);
}

export function parseInstalledDockId(value: string): string {
  const parts = value.trim().split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("dock id must be in owner/name form");
  }
  return `${parts[0]}/${parts[1]}`;
}

export function dockIdFromReference(value: string): string | undefined {
  try {
    const [id] = value.trim().split("@");
    return parseInstalledDockId(id ?? "");
  } catch {
    return undefined;
  }
}

export function parseAuthProvider(value: string): AuthProvider {
  const normalized = value.trim().toLowerCase();
  if (normalized === "google" || normalized === "github") {
    return normalized;
  }
  throw new Error("auth provider must be google or github");
}

export function resolveCliPlatform(value: string | undefined): OpenDockPlatform {
  return value === undefined ? detectPlatform() : parsePlatform(value);
}

export function resolveDeployPlatform(
  value: string | undefined,
  manifestPath: string | undefined,
): OpenDockPlatform {
  return value === undefined
    ? inferDeployPlatformFromManifestPath(manifestPath)
    : parsePlatform(value);
}

function inferDeployPlatformFromManifestPath(manifestPath: string | undefined): OpenDockPlatform {
  if (manifestPath === undefined) {
    return detectPlatform();
  }
  const tokens = new Set(basename(manifestPath).toLowerCase().split("."));
  if (tokens.has("macos") || tokens.has("mac") || tokens.has("darwin")) {
    return "macos";
  }
  if (tokens.has("windows") || tokens.has("win") || tokens.has("win32")) {
    return "windows";
  }
  if (tokens.has("linux")) {
    return "linux";
  }
  return detectPlatform();
}
