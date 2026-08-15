import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  assertRealDirectoryPath,
  ensureRealDirectoryPath,
  pruneEmptyDirectoryChain,
} from "../files/path-utils.js";

interface LockOwner {
  nonce: string;
  operation: string;
  pid: number;
  startedAt: string;
}

export class ProjectOperationLock {
  private released = false;

  private constructor(
    private readonly projectDir: string,
    private readonly lockPath: string,
    private readonly owner: LockOwner,
  ) {}

  static acquire(
    projectDir: string,
    operation: string,
    allowInterruptedRecovery = false,
  ): ProjectOperationLock {
    ensureRealDirectoryPath(projectDir, ".opendock", "OpenDock operation lock root");
    const lockPath = join(projectDir, ".opendock", "operation.lock");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const owner: LockOwner = {
        nonce: randomUUID(),
        operation,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      };
      try {
        mkdirSync(lockPath, { mode: 0o700 });
        writeFileSync(join(lockPath, "owner.json"), `${JSON.stringify(owner)}\n`, {
          flag: "wx",
          mode: 0o600,
        });
        return new ProjectOperationLock(projectDir, lockPath, owner);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          rmSync(lockPath, { force: true, recursive: true });
          throw error;
        }
      }

      const existing = readOwner(lockPath);
      if (processExists(existing.pid)) {
        throw new Error(
          `another OpenDock operation is in progress: ${existing.operation} (pid ${existing.pid})`,
        );
      }
      if (!allowInterruptedRecovery) {
        throw new Error(
          `previous OpenDock operation was interrupted: ${existing.operation} (pid ${existing.pid}); rerun the intended install, update, or uninstall with --force to recover`,
        );
      }
      const stalePath = `${lockPath}.stale-${randomUUID()}`;
      try {
        renameSync(lockPath, stalePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      rmSync(stalePath, { force: true, recursive: true });
    }
    throw new Error("could not acquire the OpenDock project operation lock");
  }

  release(): void {
    if (this.released) return;
    const current = readOwner(this.lockPath);
    if (current.nonce !== this.owner.nonce || current.pid !== this.owner.pid) {
      throw new Error("OpenDock operation lock ownership changed before release");
    }
    rmSync(this.lockPath, { force: true, recursive: true });
    this.released = true;
    pruneEmptyDirectoryChain(this.projectDir, relative(this.projectDir, this.lockPath));
  }
}

function readOwner(lockPath: string): LockOwner {
  const stat = lstatSync(lockPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`OpenDock operation lock must be a real directory: ${lockPath}`);
  }
  assertRealDirectoryPath(
    join(lockPath, "..", ".."),
    relative(join(lockPath, "..", ".."), lockPath),
    "OpenDock operation lock",
  );
  const ownerPath = join(lockPath, "owner.json");
  const ownerStat = lstatSync(ownerPath);
  if (ownerStat.isSymbolicLink() || !ownerStat.isFile() || ownerStat.nlink !== 1) {
    throw new Error(
      `OpenDock operation lock owner must be a single-link regular file: ${ownerPath}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(ownerPath, "utf8"));
  } catch (error) {
    throw new Error(`invalid OpenDock operation lock owner: ${ownerPath}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid OpenDock operation lock owner: ${ownerPath}`);
  }
  const record = parsed as Record<string, unknown>;
  if (
    !Number.isSafeInteger(record.pid) ||
    Number(record.pid) <= 1 ||
    typeof record.nonce !== "string" ||
    record.nonce === "" ||
    typeof record.operation !== "string" ||
    record.operation === "" ||
    typeof record.startedAt !== "string" ||
    record.startedAt === ""
  ) {
    throw new Error(`invalid OpenDock operation lock owner: ${ownerPath}`);
  }
  return {
    nonce: record.nonce,
    operation: record.operation,
    pid: Number(record.pid),
    startedAt: record.startedAt,
  };
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
