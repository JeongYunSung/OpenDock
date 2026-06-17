import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import type { FileSpec } from "../domain/manifest.js";
import {
  assertRegularOrMissing,
  assertSafeRelativePath,
  ensureParentDirectory,
  listRegularFiles,
  normalizeRelativePath,
  safeJoin,
  toPosixPath,
} from "./path-utils.js";

export interface WorkdirSeedMapping extends FileSpec {
  sourceRoot: string;
}

export class WorkdirSeeder {
  seed(workdir: string, mappings: WorkdirSeedMapping[]): void {
    if (mappings.length === 0) {
      return;
    }
    const stat = lstatIfPresent(workdir);
    if (stat) {
      if (stat.isSymbolicLink()) {
        throw new Error(`dock workdir cannot be a symlink: ${workdir}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`dock workdir must be a directory: ${workdir}`);
      }
    } else {
      mkdirSync(workdir, { recursive: true });
    }
    for (const mapping of mappings) {
      this.seedMapping(workdir, mapping);
    }
  }

  private seedMapping(workdir: string, mapping: WorkdirSeedMapping): void {
    const from = assertSafeRelativePath(mapping.from, "workdir file source");
    const to = assertSafeRelativePath(mapping.to, "workdir file target");
    const sourcePath = safeJoin(mapping.sourceRoot, from, "workdir file source");
    if (!existsSync(sourcePath)) {
      throw new Error(`workdir file source does not exist: ${from}`);
    }
    const stat = lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`workdir file source cannot be a symlink: ${from}`);
    }
    if (stat.isFile()) {
      this.copyFile(mapping.sourceRoot, workdir, from, to);
      return;
    }
    if (!stat.isDirectory()) {
      throw new Error(`workdir file source must be a regular file or directory: ${from}`);
    }

    const targetRoot = normalizeRelativePath(to);
    for (const sourceRel of listRegularFiles(sourcePath, from)) {
      const childRel = toPosixPath(relative(sourcePath, safeJoin(mapping.sourceRoot, sourceRel)));
      this.copyFile(
        mapping.sourceRoot,
        workdir,
        sourceRel,
        normalizeRelativePath(`${targetRoot}/${childRel}`),
      );
    }
  }

  private copyFile(
    sourceRoot: string,
    workdir: string,
    sourceRel: string,
    targetRel: string,
  ): void {
    const source = safeJoin(sourceRoot, sourceRel, "workdir file source");
    const targetPath = assertSafeRelativePath(targetRel, "workdir file target");
    const target = safeJoin(workdir, targetPath, "workdir file target");
    assertRegularOrMissing(target, targetPath);
    ensureParentDirectory(workdir, targetPath);
    writeFileSync(target, readFileSync(source));
  }
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
