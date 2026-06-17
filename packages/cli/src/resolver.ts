import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { x as extractTar } from "tar";
import {
  assertVersionSatisfiesSelector,
  type DockManifest,
  DockRef,
  parseManifestFile,
  validateManifestFor,
} from "./core/domain/manifest.js";
import { cacheRoot } from "./paths.js";
import { isOpenDockPlatform, type OpenDockPlatform } from "./platform.js";
import { OpenDockRegistryClient } from "./registry.js";
import { isReleaseSignatureValid, verifyReleaseSignature } from "./release-signature.js";

const safeResolvedVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
const allowedArchiveEntryTypes = new Set(["File", "OldFile", "Directory"]);
const maxExtractedArchiveBytes = 100 * 1024 * 1024;
const maxExtractedEntryBytes = 25 * 1024 * 1024;
const maxExtractedEntries = 5_000;
const maxExtractedFiles = 2_000;

export interface ResolvedDock {
  manifest: DockManifest;
  version: string;
  platform: OpenDockPlatform;
  root: string;
  checksum: string;
  signature: string;
}

export async function resolveDock(
  dockRef: DockRef,
  platform: OpenDockPlatform,
): Promise<ResolvedDock> {
  return resolveRemoteDock(dockRef, platform);
}

export async function resolveLatestDock(
  owner: string,
  name: string,
  platform: OpenDockPlatform,
): Promise<ResolvedDock> {
  const client = new OpenDockRegistryClient();
  const metadata = await client.resolveDockVersion(owner, name, "latest", platform);
  return resolveRemoteDockMetadata(owner, name, metadata, `${owner}/${name}@latest`, platform);
}

async function resolveRemoteDock(
  dockRef: DockRef,
  platform: OpenDockPlatform,
): Promise<ResolvedDock> {
  const client = new OpenDockRegistryClient();
  const metadata = await client.resolveDockVersion(
    dockRef.owner,
    dockRef.name,
    dockRef.requested(),
    platform,
  );
  assertVersionSatisfiesSelector(metadata.version, dockRef.requested());
  return resolveRemoteDockMetadata(
    dockRef.owner,
    dockRef.name,
    metadata,
    dockRef.toString(),
    platform,
  );
}

async function resolveRemoteDockMetadata(
  owner: string,
  name: string,
  metadata: Awaited<ReturnType<OpenDockRegistryClient["resolveDockVersion"]>>,
  requestedLabel: string,
  platform: OpenDockPlatform,
): Promise<ResolvedDock> {
  assertSafeResolvedVersion(metadata.version);
  const exactDockRef = DockRef.parse(`${owner}/${name}@${metadata.version}`);

  if (metadata.id !== exactDockRef.id()) {
    throw new Error(
      `registry returned dock id \`${metadata.id}\` for requested \`${requestedLabel}\``,
    );
  }
  if (!metadata.approved) {
    throw new Error(`dock \`${requestedLabel}\` is not approved by OpenDock Registry`);
  }
  if (metadata.platform !== undefined && metadata.platform !== platform) {
    throw new Error(
      `registry returned ${metadata.platform} artifact for requested platform \`${platform}\``,
    );
  }
  const releasePlatform = metadata.platform ?? platform;
  if (!isOpenDockPlatform(releasePlatform)) {
    throw new Error(`registry returned unsupported platform \`${releasePlatform}\``);
  }
  if (metadata.signature.value.trim() === "") {
    throw new Error(`dock \`${requestedLabel}\` is missing an OpenDock Registry signature`);
  }
  verifyCompatibleReleaseSignature(
    {
      id: metadata.id,
      version: metadata.version,
      platform: releasePlatform,
      checksum: metadata.checksum,
    },
    metadata.signature,
  );

  const client = new OpenDockRegistryClient();
  const archive = await client.downloadDock(owner, name, metadata.version, platform);
  const actualChecksum = sha256Bytes(archive);
  if (actualChecksum !== metadata.checksum) {
    throw new Error(
      `checksum mismatch for \`${requestedLabel}\`: expected ${metadata.checksum}, got ${actualChecksum}`,
    );
  }

  const root = join(cacheRoot(), owner, name, metadata.version, platform);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const temp = mkdtempSync(join(tmpdir(), "opendock-"));
  const archivePath = join(temp, "dock.tgz");
  writeFileSync(archivePath, archive);
  const extractionLimits: ExtractionLimits = { entryCount: 0, fileCount: 0, totalBytes: 0 };
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
    throw new Error(`downloaded dock \`${requestedLabel}\` did not contain dock.yml`);
  }

  const manifest = parseManifestFile(join(dockRoot, "dock.yml"));
  validateManifestFor(manifest, exactDockRef);

  return {
    manifest,
    version: metadata.version,
    platform,
    root: dockRoot,
    checksum: actualChecksum,
    signature: metadata.signature.value,
  };
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifyCompatibleReleaseSignature(
  subject: Parameters<typeof verifyReleaseSignature>[0],
  signature: Parameters<typeof verifyReleaseSignature>[1],
): void {
  if (isReleaseSignatureValid(subject, signature)) {
    return;
  }
  verifyReleaseSignature({ ...subject, platform: "any" }, signature);
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
  entryCount: number;
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

  limits.entryCount += 1;
  if (limits.entryCount > maxExtractedEntries) {
    throw new Error(`downloaded dock archive contains more than ${maxExtractedEntries} entries`);
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
