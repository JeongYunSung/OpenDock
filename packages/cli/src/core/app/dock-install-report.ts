import { relative } from "node:path";
import type { OpenDockPlatform } from "../../platform.js";
import type { DockManifest } from "../domain/manifest.js";
import type { InstalledDockRecord } from "../domain/state-store.js";
import type { FileApplySummary } from "../files/file-plan.js";
import type { StepReport } from "../runtime/step-report.js";

export interface FileChangeDetails {
  created: string[];
  deleted: string[];
  reviewRequired: string[];
  updated: string[];
}

export interface InstallReport {
  dockId: string;
  fileChanges: FileChangeDetails;
  version: string;
  filesCreated: number;
  filesDeleted: number;
  filesReviewRequired: number;
  filesUpdated: number;
  platform: OpenDockPlatform;
  steps: StepReport[];
}

export interface UninstallReport {
  fileChanges: FileChangeDetails;
  dockId: string;
  filesDeleted: number;
  filesReviewRequired: number;
  filesUpdated: number;
  platform?: OpenDockPlatform;
  version: string;
}

export function installedDockRecordFor(options: {
  checksum: string;
  fileSummary: FileApplySummary;
  manifest: DockManifest;
  platform: OpenDockPlatform;
  projectDir: string;
  requested: string;
  signature: string;
  version: string;
  workdir: string;
}): InstalledDockRecord {
  return {
    id: options.manifest.id,
    name: options.manifest.name ?? options.manifest.id,
    requested: options.requested,
    version: options.version,
    checksum: options.checksum,
    signature: options.signature,
    platform: options.platform,
    workdir: relative(options.projectDir, options.workdir).replaceAll("\\", "/"),
    files: options.fileSummary.records,
    commands: Object.entries(options.manifest.commands)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, command]) => ({
        name,
        file: command.file,
        runner: command.runner,
        ...(command.description === undefined ? {} : { description: command.description }),
      })),
  };
}

export function installReportFor(options: {
  dockId: string;
  fileSummary: FileApplySummary;
  platform: OpenDockPlatform;
  steps: StepReport[];
  version: string;
}): InstallReport {
  return {
    dockId: options.dockId,
    fileChanges: fileChangesFromSummary(options.fileSummary),
    version: options.version,
    filesCreated: options.fileSummary.created,
    filesDeleted: options.fileSummary.deleted,
    filesReviewRequired: options.fileSummary.reviewRequired,
    filesUpdated: options.fileSummary.updated,
    platform: options.platform,
    steps: options.steps,
  };
}

export function uninstallReportFor(options: {
  dockId: string;
  fileSummary: FileApplySummary;
  platform?: OpenDockPlatform;
  version: string;
}): UninstallReport {
  return {
    dockId: options.dockId,
    fileChanges: fileChangesFromSummary(options.fileSummary),
    filesDeleted: options.fileSummary.deleted,
    filesReviewRequired: options.fileSummary.reviewRequired,
    filesUpdated: options.fileSummary.updated,
    version: options.version,
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  };
}

function fileChangesFromSummary(summary: FileApplySummary): FileChangeDetails {
  return {
    created: summary.createdPaths,
    deleted: summary.deletedPaths,
    reviewRequired: summary.reviewRequiredPaths,
    updated: summary.updatedPaths,
  };
}
