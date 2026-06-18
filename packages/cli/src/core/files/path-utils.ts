import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";

export function normalizeRelativePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replaceAll(/\/+/g, "/");
}

export function assertSafeRelativePath(value: string, label = "path"): string {
  const normalized = normalizeRelativePath(value);
  if (
    normalized === "" ||
    normalized === "." ||
    normalized === ".." ||
    isAbsolute(normalized) ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`unsafe ${label}: ${value}`);
  }
  return normalized;
}

function assertInsideRoot(root: string, candidate: string, label = "path"): void {
  const rootReal = resolve(root);
  const candidateReal = resolve(candidate);
  const rel = relative(rootReal, candidateReal);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${"/"}`) ||
    rel.startsWith(`..${"\\"}`)
  ) {
    throw new Error(`${label} must stay inside ${root}`);
  }
}

export function safeJoin(root: string, relativePath: string, label = "path"): string {
  const normalized = assertSafeRelativePath(relativePath, label);
  const target = resolve(root, normalized);
  assertInsideRoot(root, target, label);
  return target;
}

export function ensureSafeParent(root: string, relativePath: string): void {
  const normalized = assertSafeRelativePath(relativePath);
  const parts = normalized.split("/");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const stat = lstatIfPresent(current);
    if (!stat) {
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`target parent cannot be a symlink: ${relativePath}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`target parent must be a directory: ${relativePath}`);
    }
  }
}

export function ensureRealDirectoryPath(
  root: string,
  relativePath: string,
  label = "directory",
): void {
  const normalized = assertSafeRelativePath(relativePath, label);
  let current = root;
  for (const part of normalized.split("/")) {
    current = join(current, part);
    const stat = lstatIfPresent(current);
    if (!stat) {
      mkdirSync(current);
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} cannot be a symlink: ${normalized}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${label} must be a directory: ${normalized}`);
    }
  }
}

export function assertRealDirectoryPath(
  root: string,
  relativePath: string,
  label = "directory",
): void {
  const normalized = assertSafeRelativePath(relativePath, label);
  let current = root;
  for (const part of normalized.split("/")) {
    current = join(current, part);
    const stat = lstatIfPresent(current);
    if (!stat) {
      return;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} cannot be a symlink: ${normalized}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${label} must be a directory: ${normalized}`);
    }
  }
}

export function ensureParentDirectory(root: string, relativePath: string): void {
  ensureSafeParent(root, relativePath);
  const normalized = assertSafeRelativePath(relativePath);
  const parts = normalized.split("/");
  if (parts.length > 1) {
    mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
  }
}

export function assertRegularOrMissing(path: string, relativePath: string): void {
  const stat = lstatIfPresent(path);
  if (!stat) {
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`target cannot be a symlink: ${relativePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`target must be a regular file: ${relativePath}`);
  }
}

export function listRegularFiles(
  root: string,
  relativeRoot = "",
  options: { symlinks?: "reject" | "follow-internal" } = {},
): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return listRegularFilesInternal(root, relativeRoot, realpathSync(root), options, new Set());
}

function listRegularFilesInternal(
  root: string,
  relativeRoot: string,
  baseRoot: string,
  options: { symlinks?: "reject" | "follow-internal" },
  directoryStack: Set<string>,
): string[] {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) {
    if (options.symlinks !== "follow-internal") {
      throw new Error(`source cannot be a symlink: ${relativeRoot || root}`);
    }
    const realTarget = realpathSync(root);
    assertInsideRoot(baseRoot, realTarget, "source symlink target");
    const realTargetStat = statSync(realTarget);
    if (realTargetStat.isFile()) {
      return [normalizeRelativePath(relativeRoot)];
    }
    if (!realTargetStat.isDirectory()) {
      throw new Error(`source symlink target must be a regular file or directory: ${relativeRoot}`);
    }
    return listRegularFilesInternal(realTarget, relativeRoot, baseRoot, options, directoryStack);
  }
  if (stat.isFile()) {
    return [normalizeRelativePath(relativeRoot)];
  }
  if (!stat.isDirectory()) {
    throw new Error(`source must be a regular file or directory: ${relativeRoot || root}`);
  }

  const files: string[] = [];
  const realDirectory = realpathSync(root);
  if (directoryStack.has(realDirectory)) {
    return files;
  }
  directoryStack.add(realDirectory);
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const rel = normalizeRelativePath(relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name);
    const abs = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      if (options.symlinks !== "follow-internal") {
        throw new Error(`source cannot be a symlink: ${rel}`);
      }
      files.push(...listRegularFilesInternal(abs, rel, baseRoot, options, directoryStack));
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...listRegularFilesInternal(abs, rel, baseRoot, options, directoryStack));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`source must be a regular file: ${rel}`);
    }
    files.push(rel);
  }
  directoryStack.delete(realDirectory);
  return files;
}

export function pruneEmptyParentDirectories(root: string, relativeFilePath: string): number {
  const normalized = assertSafeRelativePath(relativeFilePath, "directory prune path");
  const parent = posix.dirname(normalized);
  return parent === "." || parent === "/" ? 0 : pruneEmptyDirectoryChain(root, parent);
}

export function pruneEmptyDirectoryChain(root: string, relativeDirectoryPath: string): number {
  const normalized = normalizeRelativePath(relativeDirectoryPath);
  if (normalized === "." || normalized === "/") {
    return 0;
  }
  let currentRelative = assertSafeRelativePath(normalized, "directory prune path");
  let pruned = 0;

  while (currentRelative !== "." && currentRelative !== "/") {
    const current = safeJoin(root, currentRelative, "directory prune path");
    if (!existsSync(current)) {
      currentRelative = posix.dirname(currentRelative);
      continue;
    }

    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      break;
    }
    if (readdirSync(current).length > 0) {
      break;
    }

    rmdirSync(current);
    pruned += 1;
    currentRelative = posix.dirname(currentRelative);
  }

  return pruned;
}

export function toPosixPath(value: string): string {
  return value.split(sep).join("/");
}

export function safeDockDirectoryName(dockId: string): string {
  const readable = dockId.replaceAll(/[^A-Za-z0-9._-]/g, "__");
  const digest = createHash("sha256").update(dockId).digest("hex").slice(0, 12);
  return `${readable}__${digest}`;
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
