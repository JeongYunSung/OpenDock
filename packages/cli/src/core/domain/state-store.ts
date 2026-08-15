import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { LOCK_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION } from "../../constants.js";
import { isOpenDockPlatform, type OpenDockPlatform } from "../../platform.js";
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
    this.assertOperationLockSafe();
    this.assertStatePathsSafe();
    const projectExists = existsSync(this.projectPath());
    const lockExists = existsSync(this.lockPath());
    if (!projectExists && !lockExists) {
      return { schema: LOCK_SCHEMA_VERSION, docks: [] };
    }
    if (!projectExists || !lockExists) {
      throw new Error(
        "OpenDock state is incomplete: project.yml and dock.lock.yml must both exist",
      );
    }
    const lock = parseLockState(readFileSync(this.lockPath(), "utf8"), this.lockPath());
    const project = parseProjectState(readFileSync(this.projectPath(), "utf8"), this.projectPath());
    assertStateFilesAgree(project, lock);
    return lock;
  }

  hasState(): boolean {
    this.assertOperationLockSafe();
    this.assertStatePathsSafe();
    const projectExists = existsSync(this.projectPath());
    const lockExists = existsSync(this.lockPath());
    if (!projectExists && !lockExists) return false;
    this.readLock();
    return true;
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
      if (stat.nlink !== 1) {
        throw new Error(`OpenDock state file cannot be a hardlink: ${path}`);
      }
    }
  }

  private assertOperationLockSafe(): void {
    const operationPath = join(this.opendockDir(), "operation.lock");
    const stat = lstatIfPresent(operationPath);
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`OpenDock operation lock must be a real directory: ${operationPath}`);
    }
    const ownerPath = join(operationPath, "owner.json");
    const ownerStat = lstatIfPresent(ownerPath);
    if (!ownerStat || ownerStat.isSymbolicLink() || !ownerStat.isFile() || ownerStat.nlink !== 1) {
      throw new Error(`invalid OpenDock operation lock owner: ${ownerPath}`);
    }
    let owner: unknown;
    try {
      owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    } catch (error) {
      throw new Error(`invalid OpenDock operation lock owner: ${ownerPath}`, { cause: error });
    }
    if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
      throw new Error(`invalid OpenDock operation lock owner: ${ownerPath}`);
    }
    const record = owner as Record<string, unknown>;
    if (
      !Number.isSafeInteger(record.pid) ||
      Number(record.pid) <= 1 ||
      typeof record.operation !== "string" ||
      record.operation === ""
    ) {
      throw new Error(`invalid OpenDock operation lock owner: ${ownerPath}`);
    }
    const pid = Number(record.pid);
    if (pid === process.pid) return;
    if (processExists(pid)) {
      throw new Error(
        `another OpenDock operation is in progress: ${record.operation} (pid ${pid})`,
      );
    }
    throw new Error(
      `previous OpenDock operation was interrupted: ${record.operation} (pid ${pid}); rerun the intended install, update, or uninstall with --force to recover`,
    );
  }
}

function parseLockState(content: string, path: string): LockState {
  const parsed = parseStateDocument(content, path);
  if (parsed.schema !== LOCK_SCHEMA_VERSION) {
    throw new Error(`unsupported OpenDock lock schema in ${path}: ${String(parsed.schema)}`);
  }
  if (!Array.isArray(parsed.docks)) {
    throw new Error(`OpenDock lock docks must be an array: ${path}`);
  }
  const docks = parsed.docks.map((dock, index) => normalizeInstalledDockRecord(dock, path, index));
  assertUniqueDockIds(docks, path);
  return { schema: LOCK_SCHEMA_VERSION, docks };
}

function parseProjectState(content: string, path: string): ProjectState {
  const parsed = parseStateDocument(content, path);
  if (parsed.schema !== PROJECT_SCHEMA_VERSION) {
    throw new Error(`unsupported OpenDock project schema in ${path}: ${String(parsed.schema)}`);
  }
  if (!Array.isArray(parsed.docks)) {
    throw new Error(`OpenDock project docks must be an array: ${path}`);
  }
  const docks = parsed.docks.map((dock, index) => {
    const record = requireRecord(dock, `OpenDock project dock ${index} in ${path}`);
    const platform = requireString(record.platform, `project dock platform at index ${index}`);
    if (!isOpenDockPlatform(platform)) {
      throw new Error(`invalid project dock platform at index ${index}: ${platform}`);
    }
    return {
      id: requireString(record.id, `project dock id at index ${index}`),
      name: requireString(record.name, `project dock name at index ${index}`),
      requested: requireString(record.requested, `project dock requested at index ${index}`),
      version: requireString(record.version, `project dock version at index ${index}`),
      platform,
      workdir: requireString(record.workdir, `project dock workdir at index ${index}`),
    };
  });
  assertUniqueDockIds(docks, path);
  return { schema: PROJECT_SCHEMA_VERSION, docks };
}

function parseStateDocument(content: string, path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (error) {
    throw new Error(`invalid OpenDock state YAML: ${path}`, { cause: error });
  }
  return requireRecord(parsed, `OpenDock state document ${path}`);
}

function normalizeInstalledDockRecord(
  dock: unknown,
  path: string,
  index: number,
): InstalledDockRecord {
  const record = requireRecord(dock, `OpenDock lock dock ${index} in ${path}`);
  const platform = requireString(record.platform, `lock dock platform at index ${index}`);
  if (!isOpenDockPlatform(platform)) {
    throw new Error(`invalid lock dock platform at index ${index}: ${platform}`);
  }
  for (const field of ["files", "runtimes", "tools", "dependencies"] as const) {
    if (record[field] !== undefined && !Array.isArray(record[field])) {
      throw new Error(`lock dock ${field} must be an array at index ${index}`);
    }
  }
  return {
    id: requireString(record.id, `lock dock id at index ${index}`),
    name: requireString(record.name, `lock dock name at index ${index}`),
    requested: requireString(record.requested, `lock dock requested at index ${index}`),
    version: requireString(record.version, `lock dock version at index ${index}`),
    checksum: requireString(record.checksum, `lock dock checksum at index ${index}`),
    signature: requireString(record.signature, `lock dock signature at index ${index}`),
    platform,
    workdir: requireString(record.workdir, `lock dock workdir at index ${index}`),
    files: (record.files ?? []) as AppliedFileRecord[],
    runtimes: (record.runtimes ?? []) as InstalledRuntimeRecord[],
    tools: (record.tools ?? []) as InstalledToolRecord[],
    dependencies: (record.dependencies ?? []) as InstalledDependencyRecord[],
  };
}

function assertStateFilesAgree(project: ProjectState, lock: LockState): void {
  const projectDocks = [...project.docks].sort((a, b) => a.id.localeCompare(b.id));
  const lockDocks = lock.docks
    .map(({ id, name, requested, version, platform, workdir }) => ({
      id,
      name,
      requested,
      version,
      platform,
      workdir,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(projectDocks) !== JSON.stringify(lockDocks)) {
    throw new Error("OpenDock project.yml and dock.lock.yml describe different installed docks");
  }
}

function assertUniqueDockIds(docks: Array<{ id: string }>, path: string): void {
  const ids = new Set<string>();
  for (const dock of docks) {
    if (ids.has(dock.id))
      throw new Error(`duplicate dock id in OpenDock state ${path}: ${dock.id}`);
    ids.add(dock.id);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
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

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
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
