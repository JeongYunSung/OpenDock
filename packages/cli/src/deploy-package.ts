import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { c as createTar } from "tar";
import type { DockManifest } from "./core/domain/manifest.js";
import {
  assertRegularOrMissing,
  assertSafeRelativePath,
  normalizeRelativePath,
  safeJoin,
} from "./core/files/path-utils.js";
import type { OpenDockPlatform } from "./platform.js";
import type { SubmissionLogoRequest, SubmissionRequest } from "./registry.js";
import {
  assertCommandRunnerMatchesFile,
  parseRunCommandName,
  resolveCommandSource,
} from "./verified-command.js";

const maxDeployReadmeBytes = 64 * 1024;
const maxDeployLogoBytes = 512 * 1024;
const maxDeployManifestBytes = 64 * 1024;
const maxDeployArchiveBytes = 50 * 1024 * 1024;

export function readDeployReadme(projectDir: string, manifest: DockManifest): string | undefined {
  if (manifest.readme === undefined) {
    return undefined;
  }
  return readFileSync(
    resolveDeployFile(projectDir, manifest.readme, "readme", maxDeployReadmeBytes),
    "utf8",
  );
}

export function readDeployLogo(
  projectDir: string,
  manifest: DockManifest,
): SubmissionLogoRequest | undefined {
  if (manifest.logo === undefined) {
    return undefined;
  }

  const logoPath = resolveDeployFile(projectDir, manifest.logo, "logo", maxDeployLogoBytes);
  const logoBytes = readFileSync(logoPath);
  const contentType = logoContentType(logoPath);
  validateLogoSignature(contentType, logoBytes);
  return {
    filename: basename(logoPath),
    content_type: contentType,
    data_base64: logoBytes.toString("base64"),
  };
}

export function validateDeployCommands(projectDir: string, manifest: DockManifest): void {
  for (const [name, command] of Object.entries(manifest.commands)) {
    parseRunCommandName(name);
    const file = assertSafeRelativePath(command.file, `command \`${name}\` file`);
    assertCommandRunnerMatchesFile(command.runner, file);
    const source = resolveCommandSource(manifest, file);
    const sourcePath = safeJoin(projectDir, source, `command \`${name}\` source`);
    assertRegularOrMissing(sourcePath, source);
    if (!existsSync(sourcePath)) {
      throw new Error(`command \`${name}\` source does not exist: ${source}`);
    }
  }
}

export async function createDeployArchive(
  projectDir: string,
  manifest: DockManifest,
  version: string,
  platform: OpenDockPlatform,
  manifestText: string,
  manifestSourceName = "dock.yml",
): Promise<SubmissionRequest["archive"]> {
  const entries = collectDeployArchiveEntries(projectDir, manifest);
  validateDeployCommandText(projectDir, manifest, entries, manifestText);
  const temp = mkdtempSync(join(tmpdir(), "opendock-deploy-"));
  const stage = join(temp, "stage");
  const archivePath = join(temp, "dock.tgz");
  try {
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "dock.yml"), manifestText);
    for (const entry of entries.filter((entry) => entry !== "dock.yml")) {
      if (entry === manifestSourceName) {
        continue;
      }
      const source = join(projectDir, entry);
      const target = join(stage, entry);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    await createTar(
      {
        cwd: stage,
        file: archivePath,
        gzip: true,
        noMtime: true,
        portable: true,
        strict: true,
      },
      entries,
    );
    const stats = statSync(archivePath);
    if (stats.size > maxDeployArchiveBytes) {
      throw new Error(`dock archive exceeds ${maxDeployArchiveBytes} bytes`);
    }
    const bytes = readFileSync(archivePath);
    return {
      filename: `${manifest.id.replace("/", "-")}-${version}-${platform}.tgz`,
      content_type: "application/gzip",
      data_base64: bytes.toString("base64"),
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    rmSync(temp, { force: true, recursive: true });
  }
}

export function resolveDeployManifest(projectDir: string, relativePathValue: string): string {
  return resolveDeployFile(projectDir, relativePathValue, "manifest", maxDeployManifestBytes);
}

function resolveDeployFile(
  projectDir: string,
  relativePathValue: string,
  manifestField: "logo" | "manifest" | "readme",
  maxBytes: number,
): string {
  const relativePath = relativePathValue.trim();
  if (relativePath === "") {
    throw new Error(`manifest \`${manifestField}\` path cannot be empty`);
  }

  const root = realpathSync(projectDir);
  const candidate = resolve(root, relativePath);
  const linkStats = lstatSync(candidate);
  if (linkStats.isSymbolicLink()) {
    throw new Error(`manifest \`${manifestField}\` path cannot be a symlink`);
  }
  const realCandidate = realpathSync(candidate);
  assertInsideDeployRoot(root, realCandidate, manifestField);

  const stats = statSync(realCandidate);
  if (!stats.isFile()) {
    throw new Error(`manifest \`${manifestField}\` path must point to a file`);
  }
  assertDeployFileHasSingleLink(stats, relativePath, manifestField);
  if (manifestField === "logo" && stats.size === 0) {
    throw new Error("manifest `logo` file cannot be empty");
  }
  if (stats.size > maxBytes) {
    throw new Error(`manifest \`${manifestField}\` file exceeds ${maxBytes} bytes`);
  }

  return realCandidate;
}

function assertInsideDeployRoot(root: string, candidate: string, field: string): void {
  const rel = relative(root, candidate);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${"/"}`) ||
    rel.startsWith(`..${"\\"}`)
  ) {
    throw new Error(`manifest \`${field}\` path must stay inside the dock directory`);
  }
}

function normalizeDeployPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    normalized === "" ||
    normalized === "." ||
    normalized === ".." ||
    isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`unsafe deploy archive path: ${value}`);
  }
  return normalized;
}

function logoContentType(path: string): SubmissionLogoRequest["content_type"] {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      throw new Error("manifest `logo` path must point to a png, jpg, jpeg, or webp file");
  }
}

function validateLogoSignature(
  contentType: SubmissionLogoRequest["content_type"],
  bytes: Buffer,
): void {
  const valid =
    contentType === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : contentType === "image/jpeg"
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : bytes.length >= 12 &&
          bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
          bytes.subarray(8, 12).toString("ascii") === "WEBP";

  if (!valid) {
    throw new Error("manifest `logo` bytes do not match file type");
  }
}

function validateDeployCommandText(
  projectDir: string,
  manifest: DockManifest,
  entries: string[],
  manifestText: string,
): void {
  const commands = Object.entries(manifest.commands);
  if (commands.length === 0) {
    return;
  }
  for (const entry of entries) {
    if (!isDeployTextPolicyFile(entry)) {
      continue;
    }
    const content =
      entry === "dock.yml"
        ? manifestText
        : readFileSync(safeJoin(projectDir, entry, "deploy text policy file"), "utf8");
    for (const [name, command] of commands) {
      const file = normalizeRelativePath(command.file);
      const directInvocation = directRuntimeInvocation(content, file);
      if (directInvocation) {
        throw new Error(
          `deploy text \`${entry}\` must use \`opendock run ${name}\` instead of \`${directInvocation}\``,
        );
      }
    }
  }
}

function isDeployTextPolicyFile(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return [".json", ".md", ".mdc", ".toml", ".txt", ".yaml", ".yml"].includes(extension);
}

function directRuntimeInvocation(content: string, file: string): string | undefined {
  const normalizedFile = normalizeRelativePath(file);
  const fileTokens = new Set([normalizedFile, `./${normalizedFile}`]);
  for (const line of content.replaceAll("\\", "/").split(/\r?\n/)) {
    const tokens = deployTextTokens(line);
    for (const [index, token] of tokens.entries()) {
      if (!runtimeRunnerTokens.has(token)) {
        continue;
      }
      for (const next of tokens.slice(index + 1)) {
        if (deployCommandSeparators.has(next)) {
          break;
        }
        if (fileTokens.has(next)) {
          return `${token} ${file}`;
        }
      }
    }
  }
  return undefined;
}

const runtimeRunnerTokens = new Set(["node", "bun", "python", "python3", "sh", "powershell"]);
const deployCommandSeparators = new Set(["&&", "||", "|", ";"]);

function deployTextTokens(line: string): string[] {
  return line
    .split(/\s+/)
    .map((token) => token.replace(/^[`"'([{]+/, "").replace(/[.`,"')\]}:;]+$/, ""))
    .filter((token) => token !== "");
}

function collectDeployArchiveEntries(projectDir: string, manifest: DockManifest): string[] {
  const roots = new Set<string>();
  for (const file of manifest.files) {
    roots.add(file.from);
  }
  for (const file of manifest.workdir?.files ?? []) {
    roots.add(file.from);
  }

  const entries = new Set<string>(["dock.yml"]);
  for (const root of roots) {
    for (const entry of expandDeployArchiveRoot(projectDir, root)) {
      entries.add(entry);
    }
  }
  return [...entries].sort();
}

function expandDeployArchiveRoot(projectDir: string, relativePathValue: string): string[] {
  const rel = normalizeDeployPath(relativePathValue);
  const path = resolveDeployFileOrDirectory(projectDir, rel);
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) {
    throw new Error(`deploy archive entry cannot be a symlink: ${rel}`);
  }
  if (stats.isFile()) {
    assertDeployFileHasSingleLink(stats, rel, "archive entry");
    return [rel];
  }
  if (!stats.isDirectory()) {
    throw new Error(`deploy archive entry must be a regular file or directory: ${rel}`);
  }
  return listDeployDirectoryFiles(projectDir, path);
}

function listDeployDirectoryFiles(projectDir: string, root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    const rel = normalizeDeployPath(relative(projectDir, path));
    if (entry.isSymbolicLink()) {
      throw new Error(`deploy archive entry cannot be a symlink: ${rel}`);
    }
    if (entry.isDirectory()) {
      files.push(...listDeployDirectoryFiles(projectDir, path));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`deploy archive entry must be a regular file: ${rel}`);
    }
    assertDeployFileHasSingleLink(lstatSync(path), rel, "archive entry");
    files.push(rel);
  }
  return files;
}

function resolveDeployFileOrDirectory(projectDir: string, relativePathValue: string): string {
  const root = realpathSync(projectDir);
  const candidate = resolve(root, relativePathValue);
  if (lstatSync(candidate).isSymbolicLink()) {
    throw new Error(`deploy archive entry cannot be a symlink: ${relativePathValue}`);
  }
  const realCandidate = realpathSync(candidate);
  assertInsideDeployRoot(root, realCandidate, "archive entry");
  return realCandidate;
}

function assertDeployFileHasSingleLink(
  stats: { nlink: number },
  path: string,
  field: string,
): void {
  if (stats.nlink > 1) {
    if (field === "archive entry") {
      throw new Error(`deploy archive entry cannot be a hardlink: ${path}`);
    }
    throw new Error(`manifest \`${field}\` path cannot be a hardlink: ${path}`);
  }
}
