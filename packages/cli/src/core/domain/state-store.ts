import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  prefixNewlines?: number;
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
  dependencies: InstalledDependencyRecord[];
  files: AppliedFileRecord[];
}

export interface InstalledRuntimeRecord {
  name: string;
  requested: string;
  source?: "host" | "managed";
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

export interface InstalledDependencyRecord {
  name: string;
  manager: string;
  mode: string;
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

interface StateFileSnapshot {
  content: Buffer;
  mode: number;
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
    this.assertStatePathsSafe();
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
    const writes = [
      { path: this.projectPath(), content: YAML.stringify(project) },
      {
        path: this.lockPath(),
        content: YAML.stringify({ schema: LOCK_SCHEMA_VERSION, docks: sortedDocks }),
      },
    ];
    const snapshots = new Map(writes.map(({ path }) => [path, snapshotStateFile(path)]));
    const staged: Array<{ path: string; temporaryPath: string }> = [];
    const changed: string[] = [];
    try {
      for (const write of writes) {
        staged.push({
          path: write.path,
          temporaryPath: stageStateFile(write.path, write.content, snapshots.get(write.path)),
        });
      }
      for (const write of staged) {
        renameSync(write.temporaryPath, write.path);
        changed.push(write.path);
      }
    } catch (error) {
      for (const write of staged) {
        rmSync(write.temporaryPath, { force: true });
      }
      const rollbackErrors: unknown[] = [];
      for (const path of changed.reverse()) {
        try {
          restoreStateFile(path, snapshots.get(path));
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "OpenDock state write failed and previous state could not be restored",
        );
      }
      throw error;
    }
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
    dependencies: Array.isArray(dock.dependencies) ? dock.dependencies : [],
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

function snapshotStateFile(path: string): StateFileSnapshot | undefined {
  const stat = lstatIfPresent(path);
  if (!stat) return undefined;
  return { content: readFileSync(path), mode: Number(stat.mode) & 0o777 };
}

function stageStateFile(
  path: string,
  content: string | Buffer,
  snapshot: StateFileSnapshot | undefined,
): string {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporaryPath, content, {
    flag: "wx",
    mode: snapshot?.mode ?? 0o600,
  });
  return temporaryPath;
}

function restoreStateFile(path: string, snapshot: StateFileSnapshot | undefined): void {
  if (!snapshot) {
    rmSync(path, { force: true });
    return;
  }
  const temporaryPath = stageStateFile(path, snapshot.content, snapshot);
  try {
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
