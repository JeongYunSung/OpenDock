import { homedir } from "node:os";
import { join } from "node:path";

export function dataRoot(): string {
  return join(homedir(), "Library", "Application Support", "OpenDock");
}

export function cacheRoot(): string {
  return join(homedir(), "Library", "Caches", "OpenDock", "docks");
}
