import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { appendRunLog } from "./logging.js";
import type { PackRef } from "./pack.js";
import { type ProjectFileRecord, readProjectFile, writeProjectState } from "./project.js";
import { fileChecksum, isFile, resolvePack, textChecksum } from "./resolver.js";
import { runSetup, type StepReport } from "./runner.js";

export interface InstallOptions {
  packRef: PackRef;
  projectDir: string;
  runCommands: boolean;
  operation: string;
}

export interface InstallReport {
  packId: string;
  version: string;
  filesCreated: number;
  filesUpdated: number;
  steps: StepReport[];
}

interface TemplateReport {
  created: number;
  updated: number;
  records: ProjectFileRecord[];
}

export async function install(options: InstallOptions): Promise<InstallReport> {
  const resolved = await resolvePack(options.packRef);
  const priorRecords = readProjectFile(options.projectDir)?.files ?? [];
  const templateReport = applyTemplates(
    join(resolved.root, "templates"),
    options.projectDir,
    resolved.manifest.id,
    priorRecords,
  );

  let steps: StepReport[] = [];
  if (options.runCommands) {
    try {
      steps = runSetup(resolved.manifest, options.projectDir);
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
  );

  const report: InstallReport = {
    packId: resolved.manifest.id,
    version: resolved.manifest.version,
    filesCreated: templateReport.created,
    filesUpdated: templateReport.updated,
    steps,
  };

  appendRunLog(
    options.projectDir,
    options.operation,
    report.packId,
    "Success",
    `${report.packId}@${report.version} (${report.filesCreated} created, ${report.filesUpdated} updated)`,
  );

  return report;
}

function applyTemplates(
  templateRoot: string,
  projectDir: string,
  packId: string,
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
      upsertManagedBlock(target, packId, rel, content);
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
  packId: string,
  relPath: string,
  content: string,
): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const start = `<!-- OPENDOCK:START ${packId}:${relPath} -->`;
  const end = `<!-- OPENDOCK:END ${packId}:${relPath} -->`;
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
