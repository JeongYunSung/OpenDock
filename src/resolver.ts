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
import YAML from "yaml";
import { DockHubClient } from "./dockhub.js";
import {
  type PackManifest,
  type PackRef,
  packManifestSchema,
  validateManifestFor,
} from "./pack.js";
import { cacheRoot } from "./paths.js";

export interface ResolvedPack {
  manifest: PackManifest;
  root: string;
  checksum: string;
  signature: string;
}

export async function resolvePack(packRef: PackRef): Promise<ResolvedPack> {
  return resolveRemotePack(packRef);
}

export function resolveLocalPack(packsRoot: string, packRef: PackRef): ResolvedPack {
  const packRoot = findLocalPackRoot(packsRoot, packRef);
  if (!packRoot) {
    throw new Error(`pack \`${packRef}\` was not found in ${packsRoot}`);
  }

  const manifestPath = join(packRoot, "dock.yml");
  const manifest = parseManifest(manifestPath);
  validateManifestFor(manifest, packRef);

  return {
    manifest,
    root: packRoot,
    checksum: checksumDir(packRoot),
    signature: "local-dev",
  };
}

async function resolveRemotePack(packRef: PackRef): Promise<ResolvedPack> {
  const client = new DockHubClient();
  const metadata = await client.latestPackVersion(packRef.owner, packRef.name);

  if (metadata.id !== packRef.id()) {
    throw new Error(`registry returned pack id \`${metadata.id}\` for requested \`${packRef}\``);
  }
  if (!metadata.approved) {
    throw new Error(`pack \`${packRef}\` is not approved by DockHub`);
  }
  if (metadata.signature.trim() === "") {
    throw new Error(`pack \`${packRef}\` is missing a DockHub signature`);
  }

  const archive = await client.downloadPack(packRef.owner, packRef.name, metadata.version);
  const actualChecksum = sha256Bytes(archive);
  if (actualChecksum !== metadata.checksum) {
    throw new Error(
      `checksum mismatch for \`${packRef}\`: expected ${metadata.checksum}, got ${actualChecksum}`,
    );
  }

  const root = join(cacheRoot(), packRef.owner, packRef.name, metadata.version);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const temp = mkdtempSync(join(tmpdir(), "opendock-"));
  const archivePath = join(temp, "pack.tgz");
  writeFileSync(archivePath, archive);

  await extractTar({
    file: archivePath,
    cwd: root,
    filter: (entryPath) => isSafeArchivePath(root, entryPath),
  });
  rmSync(temp, { recursive: true, force: true });

  const packRoot = findManifestRoot(root);
  if (!packRoot) {
    throw new Error(`downloaded pack \`${packRef}\` did not contain dock.yml`);
  }

  const manifest = parseManifest(join(packRoot, "dock.yml"));
  validateManifestFor(manifest, packRef);

  return {
    manifest,
    root: packRoot,
    checksum: actualChecksum,
    signature: metadata.signature,
  };
}

function parseManifest(path: string): PackManifest {
  try {
    return packManifestSchema.parse(YAML.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`failed to parse ${path}: ${(error as Error).message}`);
  }
}

function findLocalPackRoot(packsRoot: string, packRef: PackRef): string | undefined {
  const candidates = [
    join(packsRoot, packRef.owner, packRef.name),
    join(packsRoot, `${packRef.owner}__${packRef.name}`),
    join(packsRoot, packRef.name),
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
