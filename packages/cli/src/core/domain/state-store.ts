import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { LOCK_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION } from "../../constants.js";
import type { OpenDockPlatform } from "../../platform.js";
import { assertRealDirectoryPath, ensureRealDirectoryPath } from "../files/path-utils.js";

export type ManagedMode = "managed_block" | "managed_file";

export interface AppliedFileRecord {
  path: string;
  mode: ManagedMode;
  checksum: string;
  markerId?: string;
  source: "files" | "export";
  executable?: boolean;
}

export interface InstalledDockRecord {
  id: string;
  name: string;
  requested: string;
  version: string;
  checksum: string;
  signature: string;
  platform: OpenDockPlatform;
  workdir: string;
  runtimes: InstalledRuntimeRecord[];
  tools: InstalledToolRecord[];
  files: AppliedFileRecord[];
}

export interface InstalledRuntimeRecord {
  name: string;
  requested: string;
  version: string;
  path: string;
  commands: string[];
}

export interface InstalledToolRecord {
  name: string;
  manager: string;
  package: string;
  version: string;
  commands: string[];
  path: string;
}

interface ProjectState {
  schema: string;
  docks: Array<{
    id: string;
    name: string;
    requested: string;
    version: string;
    platform: OpenDockPlatform;
    workdir: string;
  }>;
}

export interface LockState {
  schema: string;
  docks: InstalledDockRecord[];
}

export class OpenDockStateStore {
  constructor(private readonly projectDir: string) {}

  opendockDir(): string {
    return join(this.projectDir, ".opendock");
  }

  projectPath(): string {
    return join(this.opendockDir(), "project.yml");
  }

  lockPath(): string {
    return join(this.opendockDir(), "dock.lock.yml");
  }

  readLock(): LockState {
    this.assertStatePathsSafe();
    if (!existsSync(this.lockPath())) {
      return { schema: LOCK_SCHEMA_VERSION, docks: [] };
    }
    const parsed = YAML.parse(readFileSync(this.lockPath(), "utf8")) as Partial<LockState>;
    return {
      schema: parsed.schema ?? LOCK_SCHEMA_VERSION,
      docks: Array.isArray(parsed.docks) ? parsed.docks.map(normalizeInstalledDockRecord) : [],
    };
  }

  hasState(): boolean {
    this.assertStatePathsSafe();
    return existsSync(this.projectPath()) && existsSync(this.lockPath());
  }

  findDock(id: string): InstalledDockRecord | undefined {
    return this.readLock().docks.find((dock) => dock.id === id);
  }

  saveDock(record: InstalledDockRecord): void {
    const lock = this.readLock();
    const nextDocks = lock.docks.filter((dock) => dock.id !== record.id);
    nextDocks.push(record);
    this.write({ schema: LOCK_SCHEMA_VERSION, docks: nextDocks });
  }

  removeDock(id: string): void {
    const lock = this.readLock();
    this.write({
      schema: LOCK_SCHEMA_VERSION,
      docks: lock.docks.filter((dock) => dock.id !== id),
    });
  }

  private write(lock: LockState): void {
    ensureRealDirectoryPath(this.projectDir, ".opendock", "OpenDock state directory");
    const sortedDocks = [...lock.docks].sort((a, b) => a.id.localeCompare(b.id));
    const project: ProjectState = {
      schema: PROJECT_SCHEMA_VERSION,
      docks: sortedDocks.map((dock) => ({
        id: dock.id,
        name: dock.name,
        requested: dock.requested,
        version: dock.version,
        platform: dock.platform,
        workdir: dock.workdir,
      })),
    };
    writeFileSync(this.projectPath(), YAML.stringify(project));
    writeFileSync(
      this.lockPath(),
      YAML.stringify({ schema: LOCK_SCHEMA_VERSION, docks: sortedDocks }),
    );
  }

  private assertStatePathsSafe(): void {
    assertRealDirectoryPath(this.projectDir, ".opendock", "OpenDock state directory");
    for (const path of [this.projectPath(), this.lockPath()]) {
      const stat = lstatIfPresent(path);
      if (!stat) {
        continue;
      }
      if (stat.isSymbolicLink()) {
        throw new Error(`OpenDock state file cannot be a symlink: ${path}`);
      }
      if (!stat.isFile()) {
        throw new Error(`OpenDock state path must be a file: ${path}`);
      }
    }
  }
}

function normalizeInstalledDockRecord(dock: InstalledDockRecord): InstalledDockRecord {
  return {
    ...dock,
    files: Array.isArray(dock.files) ? dock.files : [],
    runtimes: Array.isArray(dock.runtimes) ? dock.runtimes : [],
    tools: Array.isArray(dock.tools) ? dock.tools : [],
  };
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
