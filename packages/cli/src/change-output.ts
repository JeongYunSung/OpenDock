import { type ChangeEventReporter, createChangeEventReporter, printJson } from "./change-events.js";
import { errorMessage } from "./cli-errors.js";
import type {
  FileChangeDetails,
  InstallReport,
  UninstallReport,
} from "./core/app/dock-install-report.js";
import { type InstalledDockRecord, OpenDockStateStore } from "./core/domain/state-store.js";
import type { OpenDockPlatform } from "./platform.js";

export type JsonChangeOperation = "install" | "uninstall" | "update";
type JsonChangeStatus = "installed" | "unchanged" | "uninstalled" | "updated";
type JsonCommandErrorCode = "command_failed" | "managed_file_modified";

export interface InstalledDockUpdateCheck {
  dock: InstalledDockRecord;
  latestVersion: string;
  platform: OpenDockPlatform;
  updateAvailable: boolean;
}

interface JsonDockUpdateCheckReport {
  currentVersion: string;
  dockId: string;
  latestVersion: string;
  platform: OpenDockPlatform;
  status: "current" | "outdated";
}

interface JsonUpdateCheckCommandResult {
  reports: JsonDockUpdateCheckReport[];
  success: true;
  summary: {
    current: string[];
    outdated: string[];
  };
  updatesAvailable: boolean;
}

interface JsonInstalledDockReport {
  dockId: string;
  fileCount: number;
  platform: OpenDockPlatform;
  requested: string;
  status: "installed";
  version: string;
}

interface JsonInstalledDockListCommandResult {
  docks: InstalledDockRecord[];
  hasState: boolean;
  lockPath: string;
  operation: "list";
  projectDir: string;
  projectPath: string;
  reports: JsonInstalledDockReport[];
  success: true;
  summary: {
    installed: string[];
  };
}

export interface JsonDockChangeReport {
  dockId: string;
  fileChanges: FileChangeDetails;
  filesCreated: number;
  filesDeleted: number;
  filesReviewRequired: number;
  filesUpdated: number;
  fromVersion?: string;
  operation: JsonChangeOperation;
  platform?: OpenDockPlatform;
  status: JsonChangeStatus;
  toVersion?: string;
  version: string;
}

interface JsonChangeCommandResult {
  operation: JsonChangeOperation;
  reports: JsonDockChangeReport[];
  summary: JsonChangeSummary;
  success: true;
}

interface JsonChangeCommandFailureResult {
  errorCode: JsonCommandErrorCode;
  forceable: boolean;
  message: string;
  operation: JsonChangeOperation;
  reports: JsonDockChangeReport[];
  summary: JsonChangeSummary;
  success: false;
}

interface JsonChangeSummary {
  created: string[];
  deleted: string[];
  reviewRequired: string[];
  unchanged: string[];
  updated: string[];
}

export function updateCheckCommandResult(
  updateChecks: InstalledDockUpdateCheck[],
): JsonUpdateCheckCommandResult {
  const reports = updateChecks.map((check) => ({
    currentVersion: check.dock.version,
    dockId: check.dock.id,
    latestVersion: check.latestVersion,
    platform: check.platform,
    status: check.updateAvailable ? ("outdated" as const) : ("current" as const),
  }));
  return {
    reports,
    success: true,
    summary: {
      current: reports
        .filter((report) => report.status === "current")
        .map((report) => report.dockId),
      outdated: reports
        .filter((report) => report.status === "outdated")
        .map((report) => report.dockId),
    },
    updatesAvailable: reports.some((report) => report.status === "outdated"),
  };
}

export function installedDockListCommandResult(cwd: string): JsonInstalledDockListCommandResult {
  const store = new OpenDockStateStore(cwd);
  const hasState = store.hasState();
  const docks = hasState ? store.readLock().docks : [];
  const reports = docks.map((dock) => ({
    dockId: dock.id,
    fileCount: dock.files.length,
    platform: dock.platform,
    requested: dock.requested,
    status: "installed" as const,
    version: dock.version,
  }));
  return {
    docks,
    hasState,
    lockPath: store.lockPath(),
    operation: "list",
    projectDir: cwd,
    projectPath: store.projectPath(),
    reports,
    success: true,
    summary: {
      installed: reports.map((report) => report.dockId),
    },
  };
}

export function installChangeReport(
  report: InstallReport,
  options: {
    fromVersion?: string;
    operation: JsonChangeOperation;
    status: JsonChangeStatus;
  },
): JsonDockChangeReport {
  return {
    dockId: report.dockId,
    fileChanges: report.fileChanges,
    filesCreated: report.filesCreated,
    filesDeleted: report.filesDeleted,
    filesReviewRequired: report.filesReviewRequired,
    filesUpdated: report.filesUpdated,
    ...(options.fromVersion === undefined ? {} : { fromVersion: options.fromVersion }),
    operation: options.operation,
    platform: report.platform,
    status: options.status,
    toVersion: report.version,
    version: report.version,
  };
}

export function uninstallChangeReport(
  report: UninstallReport,
  options: {
    operation: JsonChangeOperation;
    status: JsonChangeStatus;
  },
): JsonDockChangeReport {
  return {
    dockId: report.dockId,
    fileChanges: report.fileChanges,
    filesCreated: 0,
    filesDeleted: report.filesDeleted,
    filesReviewRequired: report.filesReviewRequired,
    filesUpdated: report.filesUpdated,
    operation: options.operation,
    ...(report.platform === undefined ? {} : { platform: report.platform }),
    status: options.status,
    version: report.version,
  };
}

export function changeCommandResult(
  operation: JsonChangeOperation,
  reports: JsonDockChangeReport[],
): JsonChangeCommandResult {
  return {
    operation,
    reports,
    summary: {
      created: uniqueFlatMap(reports, (report) => report.fileChanges.created),
      deleted: uniqueFlatMap(reports, (report) => report.fileChanges.deleted),
      reviewRequired: uniqueFlatMap(reports, (report) => report.fileChanges.reviewRequired),
      unchanged: reports
        .filter((report) => report.status === "unchanged")
        .map((report) => report.dockId),
      updated: uniqueFlatMap(reports, (report) => report.fileChanges.updated),
    },
    success: true,
  };
}

function changeCommandFailureResult(
  operation: JsonChangeOperation,
  error: unknown,
): JsonChangeCommandFailureResult {
  const forceable = isForceableManagedFileError(error);
  return {
    errorCode: forceable ? "managed_file_modified" : "command_failed",
    forceable,
    message: errorMessage(error),
    operation,
    reports: [],
    summary: emptyChangeSummary(),
    success: false,
  };
}

function emptyChangeSummary(): JsonChangeSummary {
  return {
    created: [],
    deleted: [],
    reviewRequired: [],
    unchanged: [],
    updated: [],
  };
}

export function handleChangeCommandError(
  operation: JsonChangeOperation,
  error: unknown,
  json: boolean,
  events: ChangeEventReporter = createChangeEventReporter(operation, false),
): void {
  if (!json && !events.enabled) {
    throw error;
  }
  const result = changeCommandFailureResult(operation, error);
  if (events.enabled) {
    events.progress("error", result.message, 100, { level: "ERR" });
    events.result(result);
  } else {
    printJson(result);
  }
  process.exitCode = 1;
}

function isForceableManagedFileError(error: unknown): boolean {
  const message = errorMessage(error);
  return [
    "checksum mismatch for managed block",
    "checksum mismatch for managed file",
    "managed block file missing",
    "managed block missing",
    "managed file missing",
  ].some((prefix) => message.startsWith(prefix));
}

export function totalFileChanges(fileChanges: FileChangeDetails): number {
  return (
    fileChanges.created.length +
    fileChanges.deleted.length +
    fileChanges.reviewRequired.length +
    fileChanges.updated.length
  );
}

function uniqueFlatMap<T>(items: T[], map: (item: T) => string[]): string[] {
  return [...new Set(items.flatMap(map))];
}
