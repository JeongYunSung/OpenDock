import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { InstalledDockRecord } from "../domain/state-store.js";
import type { FileCandidate } from "../files/file-candidate.js";
import {
  assertRealDirectoryPath,
  assertSafeRelativePath,
  ensureSafeParent,
  pruneEmptyDirectoryChain,
  safeJoin,
} from "../files/path-utils.js";
import {
  type DependencyRecord,
  type DetachedDependencyOutput,
  detachInstalledDependencyOutputs,
  removeInstalledDependencyOutputs,
  restoreDetachedDependencyOutputs,
} from "../runtime/dependency-runner.js";

interface FileSnapshot {
  content: Buffer;
  mode: number;
  path: string;
}

export class UpdateRollback {
  private readonly absentPaths: string[];
  private readonly fileSnapshots: FileSnapshot[];
  private backupRoot: string | undefined;
  private dependencyInstallStarted = false;
  private detachedDependencies: DetachedDependencyOutput[] = [];

  constructor(
    private readonly projectDir: string,
    private readonly priorDock: InstalledDockRecord | undefined,
    candidates: FileCandidate[],
  ) {
    const paths = new Set([
      ...(priorDock?.files ?? []).map((file) => file.path),
      ...candidates.map((candidate) => candidate.path),
    ]);
    const fileSnapshots: FileSnapshot[] = [];
    const absentPaths: string[] = [];
    for (const path of paths) {
      const normalized = assertSafeRelativePath(path, "update rollback path");
      const target = safeJoin(projectDir, normalized, "update rollback path");
      ensureSafeParent(projectDir, normalized);
      if (!existsSync(target)) {
        absentPaths.push(normalized);
        continue;
      }
      const stat = lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`update rollback target must be a regular file: ${normalized}`);
      }
      fileSnapshots.push({
        content: readFileSync(target),
        mode: stat.mode,
        path: normalized,
      });
    }
    this.absentPaths = absentPaths;
    this.fileSnapshots = fileSnapshots;
  }

  detachDependencies(newDependencies: DependencyRecord[]): void {
    const dependencies = [...(this.priorDock?.dependencies ?? []), ...newDependencies];
    if (dependencies.length === 0) {
      this.dependencyInstallStarted = true;
      return;
    }
    const stateRoot = safeJoin(this.projectDir, ".opendock", "update backup root");
    assertRealDirectoryPath(this.projectDir, ".opendock", "update backup root");
    const backupParent = join(stateRoot, "update-backups");
    mkdirSync(backupParent, { recursive: true });
    assertRealDirectoryPath(
      this.projectDir,
      relative(this.projectDir, backupParent),
      "update backup root",
    );
    this.backupRoot = mkdtempSync(join(backupParent, "dock-"));
    this.detachedDependencies = detachInstalledDependencyOutputs(
      this.projectDir,
      dependencies,
      this.backupRoot,
    );
    this.dependencyInstallStarted = true;
  }

  rollback(newDependencies: DependencyRecord[]): void {
    for (const path of this.absentPaths) {
      this.removeCreatedPath(path);
    }
    for (const snapshot of this.fileSnapshots) {
      this.restoreFile(snapshot);
    }
    if (this.dependencyInstallStarted) {
      try {
        removeInstalledDependencyOutputs(this.projectDir, newDependencies);
      } catch {
        // A failed command can remove or replace a new dependency root. Restoring
        // the prior detached outputs remains the authoritative rollback action.
      }
    }
    restoreDetachedDependencyOutputs(this.projectDir, this.detachedDependencies);
    this.dispose();
  }

  commit(): void {
    for (const entry of this.detachedDependencies) {
      pruneEmptyDirectoryChain(this.projectDir, relative(this.projectDir, entry.originalPath));
    }
    this.dispose();
  }

  private dispose(): void {
    if (!this.backupRoot) return;
    const backupRoot = this.backupRoot;
    this.backupRoot = undefined;
    rmSync(backupRoot, { force: true, recursive: true });
    pruneEmptyDirectoryChain(this.projectDir, relative(this.projectDir, backupRoot));
  }

  private removeCreatedPath(path: string): void {
    const normalized = assertSafeRelativePath(path, "created update output");
    const parts = normalized.split("/");
    let current = this.projectDir;
    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      const stat = lstatIfPresent(current);
      if (!stat) return;
      if (stat.isSymbolicLink()) {
        rmSync(current, { force: true });
        const parent = relative(this.projectDir, dirname(current));
        if (parent) pruneEmptyDirectoryChain(this.projectDir, parent);
        return;
      }
      if (!stat.isDirectory()) {
        throw new Error(`created update output parent must be a directory: ${normalized}`);
      }
    }
    const target = safeJoin(this.projectDir, normalized, "created update output");
    rmSync(target, { force: true, recursive: true });
    const parent = relative(this.projectDir, dirname(target));
    if (parent) pruneEmptyDirectoryChain(this.projectDir, parent);
  }

  private restoreFile(snapshot: FileSnapshot): void {
    const parent = dirname(snapshot.path).replaceAll("\\", "/");
    if (parent !== ".") this.ensureRealDirectory(parent);
    const target = safeJoin(this.projectDir, snapshot.path, "update rollback target");
    rmSync(target, { force: true, recursive: true });
    writeFileSync(target, snapshot.content);
    chmodSync(target, snapshot.mode & 0o777);
  }

  private ensureRealDirectory(path: string): void {
    const normalized = assertSafeRelativePath(path, "update rollback parent");
    let current = this.projectDir;
    for (const part of normalized.split("/")) {
      current = join(current, part);
      const stat = lstatIfPresent(current);
      if (!stat) {
        mkdirSync(current);
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        rmSync(current, { force: true, recursive: true });
        mkdirSync(current);
      }
    }
  }
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
