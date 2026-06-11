import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { LOCK_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION } from "../../constants.js";
import type { OpenDockPlatform } from "../../platform.js";

export type ManagedMode = "managed_block" | "managed_file";

export interface AppliedFileRecord {
  path: string;
  mode: ManagedMode;
  checksum: string;
  markerId?: string;
  source: "files" | "export";
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
  files: AppliedFileRecord[];
}

export interface ProjectState {
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
    if (!existsSync(this.lockPath())) {
      return { schema: LOCK_SCHEMA_VERSION, docks: [] };
    }
    const parsed = YAML.parse(readFileSync(this.lockPath(), "utf8")) as Partial<LockState>;
    return {
      schema: parsed.schema ?? LOCK_SCHEMA_VERSION,
      docks: Array.isArray(parsed.docks) ? parsed.docks : [],
    };
  }

  hasState(): boolean {
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
    mkdirSync(this.opendockDir(), { recursive: true });
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
}
