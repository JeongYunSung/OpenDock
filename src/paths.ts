import { homedir } from "node:os";
import { join } from "node:path";

export function dataRoot(): string {
  if (process.env.OPENDOCK_DATA_DIR) {
    return process.env.OPENDOCK_DATA_DIR;
  }
  return join(homedir(), "Library", "Application Support", "OpenDock");
}

export function cacheRoot(): string {
  if (process.env.OPENDOCK_DATA_DIR) {
    return join(process.env.OPENDOCK_DATA_DIR, "packs");
  }
  return join(homedir(), "Library", "Caches", "OpenDock", "packs");
}
