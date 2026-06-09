import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import {
  assertVersionSatisfiesSelector,
  type DockRef,
  type FileSpec,
  type FileUpdatePolicy,
  type LifecyclePhase,
} from "./dock.js";
import { appendRunLog } from "./logging.js";
import { detectPlatform, type OpenDockPlatform } from "./platform.js";
import { type ProjectFileRecord, readProjectFile, writeProjectState } from "./project.js";
import { fileChecksum, isFile, type ResolvedDock, resolveDock, textChecksum } from "./resolver.js";
import { assertManifestSupportsPlatform, runLifecycle, type StepReport } from "./runner.js";

type DockResolver = (dockRef: DockRef) => Promise<ResolvedDock> | ResolvedDock;

interface InstallOptions {
  dockRef: DockRef;
  force?: boolean;
  projectDir: string;
  runCommands: boolean;
  operation: string;
  phase?: LifecyclePhase;
  platform?: OpenDockPlatform;
  resolve?: DockResolver;
}

export interface InstallReport {
  dockId: string;
  version: string;
  filesCreated: number;
  filesDeleted: number;
  filesReviewRequired: number;
  filesUpdated: number;
  platform: OpenDockPlatform;
  steps: StepReport[];
}

interface FileApplyReport {
  created: number;
  deleted: number;
  reviewRequired: number;
  updated: number;
  records: ProjectFileRecord[];
}

interface FileReviewReport {
  paths: string[];
  reviewRequired: number;
}

interface ExpandedFileSpec extends FileSpec {
  source: string;
}

export async function install(options: InstallOptions): Promise<InstallReport> {
  const resolved = await (options.resolve ?? resolveDock)(options.dockRef);
  assertVersionSatisfiesSelector(resolved.version, options.dockRef.requested());
  const platform = options.platform ?? detectPlatform();
  assertManifestSupportsPlatform(resolved.manifest, platform);
  const priorRecords = readProjectFile(options.projectDir)?.files ?? [];
  if (options.force !== true) {
    const reviewReport = collectFileReviewIssues(
      resolved.root,
      options.projectDir,
      resolved.manifest.id,
      resolved.manifest.files,
      priorRecords,
    );
    if (reviewReport.reviewRequired > 0) {
      const message = `${reviewReport.reviewRequired} file(s) require review: ${reviewReport.paths.join(", ")}. Re-run with --force to overwrite managed files.`;
      appendRunLog(options.projectDir, options.operation, resolved.manifest.id, "Failure", message);
      throw new Error(message);
    }
  }
  const fileReport = applyDockFiles(
    resolved.root,
    options.projectDir,
    resolved.manifest.id,
    resolved.manifest.files,
    priorRecords,
    options.force === true,
  );

  let steps: StepReport[] = [];
  if (options.runCommands) {
    try {
      steps = await runLifecycle(
        resolved.manifest,
        options.phase ?? "install",
        options.projectDir,
        {
          platform,
        },
      );
    } catch (error) {
      appendRunLog(
        options.projectDir,
        options.operation,
        resolved.manifest.id,
        "Failure",
        (error as Error).message,
      );
      throw error;
    }
  }

  writeProjectState(
    options.projectDir,
    resolved.manifest,
    resolved.version,
    options.dockRef.requested(),
    resolved.checksum,
    resolved.signature,
    fileReport.records,
    platform,
  );

  const report: InstallReport = {
    dockId: resolved.manifest.id,
    version: resolved.version,
    filesCreated: fileReport.created,
    filesDeleted: fileReport.deleted,
    filesReviewRequired: fileReport.reviewRequired,
    filesUpdated: fileReport.updated,
    platform,
    steps,
  };

  appendRunLog(
    options.projectDir,
    options.operation,
    report.dockId,
    "Success",
    `${report.dockId}@${report.version} (${report.filesCreated} created, ${report.filesUpdated} updated, ${report.filesDeleted} deleted, ${report.filesReviewRequired} review required)`,
  );

  return report;
}

function applyDockFiles(
  dockRoot: string,
  projectDir: string,
  dockId: string,
  files: FileSpec[],
  priorRecords: ProjectFileRecord[],
  force: boolean,
): FileApplyReport {
  const report: FileApplyReport = {
    created: 0,
    deleted: 0,
    reviewRequired: 0,
    updated: 0,
    records: [],
  };
  const priorRecordMap = new Map(priorRecords.map((record) => [record.path, record.checksum]));
  const priorRecordsByPath = new Map(priorRecords.map((record) => [record.path, record]));
  const expandedFiles = files.flatMap((file) => expandFileSpec(dockRoot, projectDir, file));
  assertUniqueTargetPaths(expandedFiles);
  const desiredPaths = new Set(expandedFiles.map((file) => file.to));

  for (const file of expandedFiles) {
    const target = join(projectDir, file.to);
    prepareTargetParent(projectDir, file.to);
    assertSafeTargetFile(target, file.to);
    const content = readFileSync(file.source, "utf8");
    const existed = existsSync(target);
    const priorRecord = priorRecordsByPath.get(file.to);

    if (!existed) {
      writeFileSync(target, content);
      report.created += 1;
      report.records.push(recordFor(file.to, textChecksum(content), file.update));
      continue;
    }

    if (file.update === "append_unique") {
      appendUniqueLines(target, content);
      report.updated += 1;
      report.records.push(recordFor(file.to, fileChecksum(target), file.update));
      continue;
    }

    if (file.update === "managed_block") {
      if (
        priorRecordMap.has(file.to) &&
        isFile(target) &&
        fileChecksum(target) === priorRecordMap.get(file.to) &&
        !hasManagedBlock(target, dockId, file.to)
      ) {
        writeFileSync(target, content);
        report.records.push(recordFor(file.to, textChecksum(content), file.update));
      } else {
        upsertManagedBlock(target, dockId, file.to, content);
        report.records.push(recordFor(file.to, fileChecksum(target), file.update));
      }
      report.updated += 1;
      continue;
    }

    if (file.update === "managed_file") {
      if (force) {
        writeFileSync(target, content);
        report.updated += 1;
        report.records.push(recordFor(file.to, textChecksum(content), file.update));
      } else if (priorRecord && isFile(target) && fileChecksum(target) === priorRecord.checksum) {
        writeFileSync(target, content);
        report.updated += 1;
        report.records.push(recordFor(file.to, textChecksum(content), file.update));
      } else if (fileChecksum(target) === textChecksum(content)) {
        report.records.push(recordFor(file.to, textChecksum(content), file.update));
      } else {
        report.reviewRequired += 1;
        if (priorRecord) {
          report.records.push(priorRecord);
        }
      }
      continue;
    }

    if (file.update === "manual_review") {
      if (
        priorRecordMap.has(file.to) &&
        isFile(target) &&
        fileChecksum(target) === priorRecordMap.get(file.to)
      ) {
        writeFileSync(target, content);
        report.updated += 1;
        report.records.push(recordFor(file.to, textChecksum(content), file.update));
      } else if (priorRecord) {
        report.records.push(priorRecord);
      }
    }
  }

  reconcileRemovedManagedFiles(projectDir, dockId, desiredPaths, priorRecords, report, force);
  return report;
}

function collectFileReviewIssues(
  dockRoot: string,
  projectDir: string,
  dockId: string,
  files: FileSpec[],
  priorRecords: ProjectFileRecord[],
): FileReviewReport {
  const paths: string[] = [];
  const priorRecordsByPath = new Map(priorRecords.map((record) => [record.path, record]));
  const expandedFiles = files.flatMap((file) => expandFileSpec(dockRoot, projectDir, file));
  assertUniqueTargetPaths(expandedFiles);
  const desiredPaths = new Set(expandedFiles.map((file) => file.to));

  for (const file of expandedFiles) {
    if (file.update !== "managed_file") {
      continue;
    }

    const target = join(projectDir, file.to);
    assertSafeTargetParent(projectDir, file.to, false);
    assertSafeTargetFile(target, file.to);
    if (!existsSync(target)) {
      continue;
    }

    const content = readFileSync(file.source, "utf8");
    const currentChecksum = fileChecksum(target);
    const incomingChecksum = textChecksum(content);
    const priorRecord = priorRecordsByPath.get(file.to);
    if (currentChecksum !== incomingChecksum && currentChecksum !== priorRecord?.checksum) {
      paths.push(file.to);
    }
  }

  for (const record of priorRecords) {
    if (desiredPaths.has(record.path) || !isSafeRelativePath(record.path)) {
      continue;
    }

    const target = join(projectDir, record.path);
    if (!existsSync(target)) {
      continue;
    }
    assertSafeTargetParent(projectDir, record.path, false);
    assertSafeTargetFile(target, record.path);

    if (record.update === "managed_file" && fileChecksum(target) !== record.checksum) {
      paths.push(record.path);
      continue;
    }

    if (
      record.update === "managed_block" &&
      fileChecksum(target) !== record.checksum &&
      !hasManagedBlock(target, dockId, record.path)
    ) {
      paths.push(record.path);
    }
  }

  const uniquePaths = [...new Set(paths)].sort();
  return { paths: uniquePaths, reviewRequired: uniquePaths.length };
}

function expandFileSpec(dockRoot: string, projectDir: string, file: FileSpec): ExpandedFileSpec[] {
  if (!isSafeRelativePath(file.from) || !isSafeRelativePath(file.to)) {
    throw new Error(`unsafe file mapping \`${file.from}\` -> \`${file.to}\``);
  }

  const source = join(dockRoot, file.from);
  if (!existsSync(source)) {
    throw new Error(`file mapping source does not exist: ${file.from}`);
  }

  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw new Error(`file mapping source cannot be a symlink: ${file.from}`);
  }
  if (stat.isFile()) {
    return [{ ...file, source }];
  }
  if (!stat.isDirectory()) {
    throw new Error(`file mapping source must be a regular file or directory: ${file.from}`);
  }

  const targetRoot = join(projectDir, file.to);
  if (existsSync(targetRoot) && !lstatSync(targetRoot).isDirectory()) {
    throw new Error(`file mapping target must be a directory: ${file.to}`);
  }

  return listSourceDirectoryFiles(source, file.from).map((entry) => {
    const rel = normalizePath(relative(source, entry.source));
    return {
      from: normalizePath(join(file.from, rel)),
      source: entry.source,
      to: normalizePath(join(file.to, rel)),
      update: file.update,
    };
  });
}

function listSourceDirectoryFiles(root: string, relRoot: string): Array<{ source: string }> {
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files: Array<{ source: string }> = [];
  for (const entry of entries) {
    const source = join(root, entry.name);
    const relPath = normalizePath(join(relRoot, entry.name));
    if (entry.isSymbolicLink()) {
      throw new Error(`file mapping source cannot be a symlink: ${relPath}`);
    }
    if (entry.isDirectory()) {
      files.push(...listSourceDirectoryFiles(source, relPath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`file mapping source must be a regular file: ${relPath}`);
    }
    files.push({ source });
  }
  return files;
}

function reconcileRemovedManagedFiles(
  projectDir: string,
  dockId: string,
  desiredPaths: Set<string>,
  priorRecords: ProjectFileRecord[],
  report: FileApplyReport,
  force: boolean,
): void {
  const recordedPaths = new Set(report.records.map((record) => record.path));

  for (const record of priorRecords) {
    if (desiredPaths.has(record.path) || recordedPaths.has(record.path)) {
      continue;
    }
    if (!isSafeRelativePath(record.path)) {
      continue;
    }

    const target = join(projectDir, record.path);
    if (!existsSync(target)) {
      continue;
    }
    assertSafeTargetParent(projectDir, record.path, false);
    assertSafeTargetFile(target, record.path);

    if (record.update === "managed_file") {
      if (force || (isFile(target) && fileChecksum(target) === record.checksum)) {
        rmSync(target);
        report.deleted += 1;
      } else {
        report.reviewRequired += 1;
        report.records.push(record);
        recordedPaths.add(record.path);
      }
      continue;
    }

    if (record.update === "managed_block") {
      if (
        isFile(target) &&
        fileChecksum(target) === record.checksum &&
        !hasManagedBlock(target, dockId, record.path)
      ) {
        rmSync(target);
        report.deleted += 1;
        continue;
      }

      const result = removeManagedBlock(target, dockId, record.path);
      if (result === "deleted") {
        report.deleted += 1;
      } else if (result === "updated") {
        report.updated += 1;
      } else if (force) {
        rmSync(target);
        report.deleted += 1;
      } else {
        report.reviewRequired += 1;
        report.records.push(record);
        recordedPaths.add(record.path);
      }
    }
  }
}

function assertUniqueTargetPaths(files: ExpandedFileSpec[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.to)) {
      throw new Error(`duplicate file mapping target: ${file.to}`);
    }
    seen.add(file.to);
  }
}

function recordFor(path: string, checksum: string, update: FileUpdatePolicy): ProjectFileRecord {
  return { path, checksum, update };
}

function appendUniqueLines(path: string, addition: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const existingLines = new Set(existing.split("\n").map((line) => line.trimEnd()));
  let output = existing.trimEnd();

  for (const line of addition.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed === "" || existingLines.has(trimmed)) {
      continue;
    }
    if (output !== "") {
      output += "\n";
    }
    output += trimmed;
  }

  writeFileSync(path, `${output}\n`);
}

function upsertManagedBlock(path: string, dockId: string, relPath: string, content: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const start = `<!-- OPENDOCK:START ${dockId}:${relPath} -->`;
  const end = `<!-- OPENDOCK:END ${dockId}:${relPath} -->`;
  const block = `${start}\n${content.trimEnd()}\n${end}`;

  let next: string;
  const startIndex = existing.indexOf(start);
  if (startIndex >= 0) {
    const endRelativeIndex = existing.slice(startIndex).indexOf(end);
    if (endRelativeIndex >= 0) {
      const endIndex = startIndex + endRelativeIndex + end.length;
      const before = existing.slice(0, startIndex).trimEnd();
      const after = existing.slice(endIndex).trimStart();
      next = before === "" ? block : `${before}\n\n${block}`;
      if (after !== "") {
        next += `\n\n${after.trimEnd()}`;
      }
      next += "\n";
    } else {
      next = appendBlock(existing, block);
    }
  } else {
    next = appendBlock(existing, block);
  }

  writeFileSync(path, next);
}

function hasManagedBlock(path: string, dockId: string, relPath: string): boolean {
  const existing = readFileSync(path, "utf8");
  const start = `<!-- OPENDOCK:START ${dockId}:${relPath} -->`;
  const end = `<!-- OPENDOCK:END ${dockId}:${relPath} -->`;
  const startIndex = existing.indexOf(start);
  return startIndex >= 0 && existing.slice(startIndex).includes(end);
}

function removeManagedBlock(
  path: string,
  dockId: string,
  relPath: string,
): "deleted" | "missing" | "updated" {
  const existing = readFileSync(path, "utf8");
  const start = `<!-- OPENDOCK:START ${dockId}:${relPath} -->`;
  const end = `<!-- OPENDOCK:END ${dockId}:${relPath} -->`;
  const startIndex = existing.indexOf(start);
  if (startIndex < 0) {
    return "missing";
  }
  const endRelativeIndex = existing.slice(startIndex).indexOf(end);
  if (endRelativeIndex < 0) {
    return "missing";
  }

  const endIndex = startIndex + endRelativeIndex + end.length;
  const before = existing.slice(0, startIndex).trimEnd();
  const after = existing.slice(endIndex).trimStart();
  if (before === "" && after === "") {
    rmSync(path);
    return "deleted";
  }

  const parts = [before, after.trimEnd()].filter((part) => part !== "");
  const next = `${parts.join("\n\n")}\n`;
  writeFileSync(path, next);
  return "updated";
}

function appendBlock(existing: string, block: string): string {
  const prefix = existing.trimEnd();
  return prefix === "" ? `${block}\n` : `${prefix}\n\n${block}\n`;
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function isSafeRelativePath(path: string): boolean {
  const normalized = normalizePath(path);
  return (
    normalized !== "" &&
    normalized !== "." &&
    !normalized.startsWith("/") &&
    !normalized.startsWith("../") &&
    !normalized.includes("/../")
  );
}

function assertSafeTargetFile(path: string, relPath: string): void {
  if (!existsSync(path)) {
    return;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`file mapping target cannot be a symlink: ${relPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`file mapping target must be a regular file: ${relPath}`);
  }
}

function prepareTargetParent(projectDir: string, relPath: string): void {
  assertSafeTargetParent(projectDir, relPath, true);
}

function assertSafeTargetParent(projectDir: string, relPath: string, create: boolean): void {
  const parts = normalizePath(relPath).split("/");
  const parentParts = parts.slice(0, -1);
  let current = projectDir;
  for (const part of parentParts) {
    current = join(current, part);
    if (!existsSync(current)) {
      continue;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`file mapping target parent cannot be a symlink: ${relPath}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`file mapping target parent must be a directory: ${relPath}`);
    }
  }
  if (create && parentParts.length > 0) {
    mkdirSync(join(projectDir, ...parentParts), { recursive: true });
  }
}
