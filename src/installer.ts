import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import {
  assertVersionSatisfiesSelector,
  type DockRef,
  type FileSpec,
  type LifecyclePhase,
} from "./dock.js";
import { appendRunLog } from "./logging.js";
import { detectPlatform, type OpenDockPlatform } from "./platform.js";
import { type ProjectFileRecord, readProjectFile, writeProjectState } from "./project.js";
import { fileChecksum, isFile, type ResolvedDock, resolveDock, textChecksum } from "./resolver.js";
import { assertManifestSupportsPlatform, runLifecycle, type StepReport } from "./runner.js";

export type DockResolver = (dockRef: DockRef) => Promise<ResolvedDock> | ResolvedDock;

export interface InstallOptions {
  dockRef: DockRef;
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
  filesUpdated: number;
  platform: OpenDockPlatform;
  steps: StepReport[];
}

interface FileApplyReport {
  created: number;
  updated: number;
  records: ProjectFileRecord[];
}

export async function install(options: InstallOptions): Promise<InstallReport> {
  const resolved = await (options.resolve ?? resolveDock)(options.dockRef);
  assertVersionSatisfiesSelector(resolved.manifest.version, options.dockRef.requested());
  const platform = options.platform ?? detectPlatform();
  assertManifestSupportsPlatform(resolved.manifest, platform);
  const priorRecords = readProjectFile(options.projectDir)?.files ?? [];
  const fileReport = applyDockFiles(
    resolved.root,
    options.projectDir,
    resolved.manifest.id,
    resolved.manifest.files,
    priorRecords,
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
    options.dockRef.requested(),
    resolved.checksum,
    resolved.signature,
    fileReport.records,
    platform,
  );

  const report: InstallReport = {
    dockId: resolved.manifest.id,
    version: resolved.manifest.version,
    filesCreated: fileReport.created,
    filesUpdated: fileReport.updated,
    platform,
    steps,
  };

  appendRunLog(
    options.projectDir,
    options.operation,
    report.dockId,
    "Success",
    `${report.dockId}@${report.version} (${report.filesCreated} created, ${report.filesUpdated} updated)`,
  );

  return report;
}

function applyDockFiles(
  dockRoot: string,
  projectDir: string,
  dockId: string,
  files: FileSpec[],
  priorRecords: ProjectFileRecord[],
): FileApplyReport {
  const report: FileApplyReport = { created: 0, updated: 0, records: [] };
  const priorRecordMap = new Map(priorRecords.map((record) => [record.path, record.checksum]));

  for (const file of files) {
    const source = join(dockRoot, file.from);
    if (!isSafeRelativePath(file.from) || !isSafeRelativePath(file.to)) {
      throw new Error(`unsafe file mapping \`${file.from}\` -> \`${file.to}\``);
    }
    assertSafeSourceFile(source, file.from);

    const target = join(projectDir, file.to);
    mkdirSync(dirname(target), { recursive: true });
    assertSafeTargetFile(target, file.to);
    const content = readFileSync(source, "utf8");
    const existed = existsSync(target);

    if (!existed) {
      writeFileSync(target, content);
      report.created += 1;
      report.records.push({ path: file.to, checksum: textChecksum(content) });
      continue;
    }

    if (file.update === "append_unique") {
      appendUniqueLines(target, content);
      report.updated += 1;
      report.records.push({ path: file.to, checksum: fileChecksum(target) });
      continue;
    }

    if (file.update === "managed_block") {
      if (
        priorRecordMap.has(file.to) &&
        isFile(target) &&
        fileChecksum(target) === priorRecordMap.get(file.to)
      ) {
        writeFileSync(target, content);
        report.records.push({ path: file.to, checksum: textChecksum(content) });
      } else {
        upsertManagedBlock(target, dockId, file.to, content);
      }
      report.updated += 1;
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
        report.records.push({ path: file.to, checksum: textChecksum(content) });
      }
    }
  }

  return report;
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

export function upsertManagedBlock(
  path: string,
  dockId: string,
  relPath: string,
  content: string,
): void {
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

function assertSafeSourceFile(path: string, relPath: string): void {
  if (!existsSync(path)) {
    throw new Error(`file mapping source does not exist: ${relPath}`);
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`file mapping source cannot be a symlink: ${relPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`file mapping source must be a regular file: ${relPath}`);
  }
}

function assertSafeTargetFile(path: string, relPath: string): void {
  if (!existsSync(path)) {
    return;
  }
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`file mapping target cannot be a symlink: ${relPath}`);
  }
}
