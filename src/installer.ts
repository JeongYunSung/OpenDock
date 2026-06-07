import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { DockRef, FileSpec, LifecyclePhase } from "./dock.js";
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

interface TemplateReport {
  created: number;
  updated: number;
  records: ProjectFileRecord[];
}

export async function install(options: InstallOptions): Promise<InstallReport> {
  const resolved = await (options.resolve ?? resolveDock)(options.dockRef);
  const platform = options.platform ?? detectPlatform();
  assertManifestSupportsPlatform(resolved.manifest, platform);
  const priorRecords = readProjectFile(options.projectDir)?.files ?? [];
  const templateReport = applyDockFiles(
    resolved.root,
    join(resolved.root, "templates"),
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
    resolved.checksum,
    resolved.signature,
    templateReport.records,
    platform,
  );

  const report: InstallReport = {
    dockId: resolved.manifest.id,
    version: resolved.manifest.version,
    filesCreated: templateReport.created,
    filesUpdated: templateReport.updated,
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
  templateRoot: string,
  projectDir: string,
  dockId: string,
  files: FileSpec[],
  priorRecords: ProjectFileRecord[],
): TemplateReport {
  if (files.length > 0) {
    return applyExplicitFiles(dockRoot, projectDir, dockId, files, priorRecords);
  }
  return applyLegacyTemplates(templateRoot, projectDir, dockId, priorRecords);
}

function applyExplicitFiles(
  dockRoot: string,
  projectDir: string,
  dockId: string,
  files: FileSpec[],
  priorRecords: ProjectFileRecord[],
): TemplateReport {
  const report: TemplateReport = { created: 0, updated: 0, records: [] };
  const priorRecordMap = new Map(priorRecords.map((record) => [record.path, record.checksum]));

  for (const file of files) {
    const source = join(dockRoot, file.from);
    if (!isSafeRelativePath(file.from) || !isSafeRelativePath(file.to)) {
      throw new Error(`unsafe file mapping \`${file.from}\` -> \`${file.to}\``);
    }
    if (!existsSync(source) || statSync(source).isDirectory()) {
      throw new Error(`file mapping source does not exist: ${file.from}`);
    }

    const target = join(projectDir, file.to);
    mkdirSync(dirname(target), { recursive: true });
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

function applyLegacyTemplates(
  templateRoot: string,
  projectDir: string,
  dockId: string,
  priorRecords: ProjectFileRecord[],
): TemplateReport {
  const report: TemplateReport = { created: 0, updated: 0, records: [] };
  if (!existsSync(templateRoot)) {
    return report;
  }

  const priorRecordMap = new Map(priorRecords.map((record) => [record.path, record.checksum]));

  for (const source of listEntries(templateRoot)) {
    if (statSync(source).isDirectory()) {
      continue;
    }

    const rel = normalizePath(relative(templateRoot, source));
    const target = join(projectDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    const content = readFileSync(source, "utf8");

    if (!existsSync(target)) {
      writeFileSync(target, content);
      report.records.push({ path: rel, checksum: textChecksum(content) });
      report.created += 1;
      continue;
    }

    if (rel === ".gitignore") {
      appendUniqueLines(target, content);
    } else if (
      priorRecordMap.has(rel) &&
      isFile(target) &&
      fileChecksum(target) === priorRecordMap.get(rel)
    ) {
      writeFileSync(target, content);
      report.records.push({ path: rel, checksum: textChecksum(content) });
    } else {
      upsertManagedBlock(target, dockId, rel, content);
    }
    report.updated += 1;
  }

  return report;
}

function listEntries(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...listEntries(path));
    } else {
      result.push(path);
    }
  }
  return result;
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
