import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { LOCK_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION } from "./constants.js";
import type { PackManifest } from "./pack.js";

export interface ProjectFileRecord {
  path: string;
  checksum: string;
}

export interface ProjectFile {
  schema: string;
  applied_packs: Array<{
    id: string;
    name: string;
    version: string;
  }>;
  files: ProjectFileRecord[];
}

export interface LockFile {
  schema: string;
  packs: Array<{
    id: string;
    version: string;
    checksum: string;
    signature: string;
  }>;
}

export function writeProjectState(
  projectDir: string,
  manifest: PackManifest,
  checksum: string,
  signature: string,
  files: ProjectFileRecord[],
): void {
  const opendockDir = join(projectDir, ".opendock");
  mkdirSync(opendockDir, { recursive: true });

  const project: ProjectFile = {
    schema: PROJECT_SCHEMA_VERSION,
    applied_packs: [
      {
        id: manifest.id,
        name: manifest.name ?? manifest.id,
        version: manifest.version,
      },
    ],
    files,
  };

  const lock: LockFile = {
    schema: LOCK_SCHEMA_VERSION,
    packs: [
      {
        id: manifest.id,
        version: manifest.version,
        checksum,
        signature,
      },
    ],
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

export function hasProjectState(projectDir: string): boolean {
  try {
    readLock(projectDir);
    return readProjectFile(projectDir) !== undefined;
  } catch {
    return false;
  }
}
