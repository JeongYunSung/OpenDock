import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { x as extractTar } from "tar";
import {
  assertVersionSatisfiesSelector,
  type DockManifest,
  type DockRef,
  parseManifestFile,
  validateManifestFor,
} from "./dock.js";
import { cacheRoot } from "./paths.js";
import { OpenDockRegistryClient } from "./registry.js";

const safeResolvedVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
const allowedArchiveEntryTypes = new Set(["File", "OldFile", "Directory"]);
const maxExtractedArchiveBytes = 100 * 1024 * 1024;
const maxExtractedEntryBytes = 25 * 1024 * 1024;
const maxExtractedFiles = 2_000;

export interface ResolvedDock {
  manifest: DockManifest;
  version: string;
  root: string;
  checksum: string;
  signature: string;
}

export async function resolveDock(dockRef: DockRef): Promise<ResolvedDock> {
  return resolveRemoteDock(dockRef);
}

export function resolveLocalDock(docksRoot: string, dockRef: DockRef): ResolvedDock {
  const dockRoot = findLocalDockRoot(docksRoot, dockRef);
  if (!dockRoot) {
    throw new Error(`dock \`${dockRef}\` was not found in ${docksRoot}`);
  }

  const manifestPath = join(dockRoot, "dock.yml");
  const manifest = parseManifestFile(manifestPath);
  validateManifestFor(manifest, dockRef);

  return {
    manifest,
    version: localDockVersion(dockRoot, dockRef),
    root: dockRoot,
    checksum: checksumDir(dockRoot),
    signature: "local-dev",
  };
}

async function resolveRemoteDock(dockRef: DockRef): Promise<ResolvedDock> {
  const client = new OpenDockRegistryClient();
  const metadata = await client.resolveDockVersion(
    dockRef.owner,
    dockRef.name,
    dockRef.requested(),
  );
  assertVersionSatisfiesSelector(metadata.version, dockRef.requested());
  assertSafeResolvedVersion(metadata.version);

  if (metadata.id !== dockRef.id()) {
    throw new Error(`registry returned dock id \`${metadata.id}\` for requested \`${dockRef}\``);
  }
  if (!metadata.approved) {
    throw new Error(`dock \`${dockRef}\` is not approved by OpenDock Registry`);
  }
  if (metadata.signature.trim() === "") {
    throw new Error(`dock \`${dockRef}\` is missing an OpenDock Registry signature`);
  }

  const archive = await client.downloadDock(dockRef.owner, dockRef.name, metadata.version);
  const actualChecksum = sha256Bytes(archive);
  if (actualChecksum !== metadata.checksum) {
    throw new Error(
      `checksum mismatch for \`${dockRef}\`: expected ${metadata.checksum}, got ${actualChecksum}`,
    );
  }

  const root = join(cacheRoot(), dockRef.owner, dockRef.name, metadata.version);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const temp = mkdtempSync(join(tmpdir(), "opendock-"));
  const archivePath = join(temp, "dock.tgz");
  writeFileSync(archivePath, archive);
  const extractionLimits: ExtractionLimits = { fileCount: 0, totalBytes: 0 };
  let blockedArchiveEntry: string | undefined;

  await extractTar({
    file: archivePath,
    cwd: root,
    filter: (entryPath, entry) => {
      try {
        return isSafeArchiveEntry(root, entryPath, entry, extractionLimits);
      } catch (error) {
        blockedArchiveEntry = (error as Error).message;
        return false;
      }
    },
  });
  rmSync(temp, { recursive: true, force: true });
  if (blockedArchiveEntry) {
    throw new Error(blockedArchiveEntry);
  }

  const dockRoot = findManifestRoot(root);
  if (!dockRoot) {
    throw new Error(`downloaded dock \`${dockRef}\` did not contain dock.yml`);
  }

  const manifest = parseManifestFile(join(dockRoot, "dock.yml"));
  validateManifestFor(manifest, dockRef);

  return {
    manifest,
    version: metadata.version,
    root: dockRoot,
    checksum: actualChecksum,
    signature: metadata.signature,
  };
}

function localDockVersion(dockRoot: string, dockRef: DockRef): string {
  const sidecar = join(dockRoot, ".opendock-version");
  if (existsSync(sidecar)) {
    const version = readFileSync(sidecar, "utf8").trim();
    if (version !== "") {
      return version;
    }
  }
  return dockRef.requested() === "latest" ? "local-dev" : dockRef.requested();
}

function findLocalDockRoot(docksRoot: string, dockRef: DockRef): string | undefined {
  const candidates = [
    join(docksRoot, dockRef.owner, dockRef.name),
    join(docksRoot, `${dockRef.owner}__${dockRef.name}`),
    join(docksRoot, dockRef.name),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, "dock.yml")));
}

function checksumDir(root: string): string {
  const files = listFiles(root).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const rel = normalizePath(relative(root, file));
    hash.update(rel);
    hash.update(Buffer.from([0]));
    hash.update(readFileSync(file));
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

function listFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`dock cache entry cannot be a symlink: ${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function findManifestRoot(root: string): string | undefined {
  if (existsSync(join(root, "dock.yml"))) {
    return root;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && existsSync(join(path, "dock.yml"))) {
      return path;
    }
  }
  return undefined;
}

function isSafeArchivePath(destination: string, entryPath: string): boolean {
  const resolved = resolve(destination, entryPath);
  const normalizedDestination = resolve(destination);
  return (
    resolved === normalizedDestination || resolved.startsWith(`${normalizedDestination}${sep}`)
  );
}

interface ArchiveEntry {
  type?: string;
  size?: number;
}

interface ExtractionLimits {
  fileCount: number;
  totalBytes: number;
}

function assertSafeResolvedVersion(version: string): void {
  if (!safeResolvedVersionPattern.test(version)) {
    throw new Error(`registry returned unsafe dock version \`${version}\``);
  }
}

function isSafeArchiveEntry(
  destination: string,
  entryPath: string,
  entry: ArchiveEntry,
  limits: ExtractionLimits,
): boolean {
  if (!isSafeArchivePath(destination, entryPath)) {
    throw new Error(`archive entry escapes destination: ${entryPath}`);
  }

  const type = entry.type ?? "";
  if (!allowedArchiveEntryTypes.has(type)) {
    throw new Error(`archive entry type \`${type || "unknown"}\` is not allowed: ${entryPath}`);
  }

  if (type === "Directory") {
    return true;
  }

  limits.fileCount += 1;
  if (limits.fileCount > maxExtractedFiles) {
    throw new Error(`downloaded dock archive contains more than ${maxExtractedFiles} files`);
  }

  const size = entry.size ?? 0;
  if (size > maxExtractedEntryBytes) {
    throw new Error(`archive entry exceeds ${maxExtractedEntryBytes} bytes: ${entryPath}`);
  }
  limits.totalBytes += size;
  if (limits.totalBytes > maxExtractedArchiveBytes) {
    throw new Error(`downloaded dock archive expands beyond ${maxExtractedArchiveBytes} bytes`);
  }

  return true;
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

export function fileChecksum(path: string): string {
  return createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");
}

export function textChecksum(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
