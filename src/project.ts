import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { LOCK_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION } from "./constants.js";
import type { DockManifest } from "./dock.js";
import type { OpenDockPlatform } from "./platform.js";

export interface ProjectFileRecord {
  path: string;
  checksum: string;
}

export interface AppliedDock {
  id: string;
  name: string;
  platform?: OpenDockPlatform;
  version: string;
}

export interface LockedDock {
  id: string;
  version: string;
  checksum: string;
  platform?: OpenDockPlatform;
  signature: string;
}

export interface ProjectFile {
  schema: string;
  applied_docks?: AppliedDock[];
  applied_packs?: AppliedDock[];
  files: ProjectFileRecord[];
}

export interface LockFile {
  schema: string;
  docks?: LockedDock[];
  packs?: LockedDock[];
}

export function writeProjectState(
  projectDir: string,
  manifest: DockManifest,
  checksum: string,
  signature: string,
  files: ProjectFileRecord[],
  platform?: OpenDockPlatform,
): void {
  const opendockDir = join(projectDir, ".opendock");
  mkdirSync(opendockDir, { recursive: true });

  const appliedDock: AppliedDock = {
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    version: manifest.version,
  };
  if (platform !== undefined) {
    appliedDock.platform = platform;
  }

  const project: ProjectFile = {
    schema: PROJECT_SCHEMA_VERSION,
    applied_docks: [appliedDock],
    files,
  };

  const lockedDock: LockedDock = {
    id: manifest.id,
    version: manifest.version,
    checksum,
    signature,
  };
  if (platform !== undefined) {
    lockedDock.platform = platform;
  }

  const lock: LockFile = {
    schema: LOCK_SCHEMA_VERSION,
    docks: [lockedDock],
  };

  writeFileSync(join(opendockDir, "project.yml"), YAML.stringify(project));
  writeFileSync(join(opendockDir, "dock.lock.yml"), YAML.stringify(lock));
}

export function readProjectFile(projectDir: string): ProjectFile | undefined {
  const path = join(projectDir, ".opendock", "project.yml");
  try {
    return YAML.parse(readFileSync(path, "utf8")) as ProjectFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new Error(`failed to read or parse ${path}: ${(error as Error).message}`);
  }
}

export function readLock(projectDir: string): LockFile {
  const path = join(projectDir, ".opendock", "dock.lock.yml");
  try {
    return YAML.parse(readFileSync(path, "utf8")) as LockFile;
  } catch (error) {
    throw new Error(`failed to read or parse ${path}: ${(error as Error).message}`);
  }
}

export function projectDocks(project: ProjectFile): AppliedDock[] {
  return project.applied_docks ?? project.applied_packs ?? [];
}

export function lockDocks(lock: LockFile): LockedDock[] {
  return lock.docks ?? lock.packs ?? [];
}

export function hasProjectState(projectDir: string): boolean {
  try {
    readLock(projectDir);
    return readProjectFile(projectDir) !== undefined;
  } catch {
    return false;
  }
}
