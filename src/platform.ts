const SUPPORTED_PLATFORMS = ["macos", "windows", "linux"] as const;

export type OpenDockPlatform = (typeof SUPPORTED_PLATFORMS)[number];
export type OpenDockReleasePlatform = OpenDockPlatform | "any";

export function detectPlatform(hostPlatform: NodeJS.Platform = process.platform): OpenDockPlatform {
  if (hostPlatform === "darwin") {
    return "macos";
  }
  if (hostPlatform === "win32") {
    return "windows";
  }
  if (hostPlatform === "linux") {
    return "linux";
  }
  throw new Error(`unsupported host platform \`${hostPlatform}\``);
}

export function parsePlatform(value: string): OpenDockPlatform {
  const normalized = value.trim().toLowerCase();
  if (normalized === "mac" || normalized === "macos" || normalized === "darwin") {
    return "macos";
  }
  if (normalized === "win" || normalized === "windows" || normalized === "win32") {
    return "windows";
  }
  if (normalized === "linux") {
    return "linux";
  }
  throw new Error(`unsupported OpenDock platform \`${value}\``);
}

export function parseReleasePlatform(value: string): OpenDockReleasePlatform {
  const normalized = value.trim().toLowerCase();
  if (normalized === "any" || normalized === "all" || normalized === "neutral") {
    return "any";
  }
  return parsePlatform(value);
}

export function isOpenDockPlatform(value: string): value is OpenDockPlatform {
  return SUPPORTED_PLATFORMS.includes(value as OpenDockPlatform);
}
