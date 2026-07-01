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
  error?: string;
  latestVersion?: string;
  platform?: OpenDockPlatform;
  updateAvailable: boolean;
}

interface JsonDockUpdateCheckReport {
  currentVersion: string;
  dockId: string;
  latestVersion?: string;
  message?: string;
  platform?: OpenDockPlatform;
  status: "current" | "failed" | "outdated";
}

interface JsonUpdateCheckCommandResult {
  reports: JsonDockUpdateCheckReport[];
  success: true;
  summary: {
    current: string[];
    failed: string[];
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

type JsonInstalledDockSummary = Omit<InstalledDockRecord, "files"> & {
  fileCount: number;
};

interface JsonInstalledDockListCommandResult {
  docks: Array<InstalledDockRecord | JsonInstalledDockSummary>;
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
  summaryCounts?: JsonChangeSummaryCounts;
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

interface JsonChangeSummaryCounts {
  created: number;
  deleted: number;
  reviewRequired: number;
  unchanged: number;
  updated: number;
}

export function updateCheckCommandResult(
  updateChecks: InstalledDockUpdateCheck[],
): JsonUpdateCheckCommandResult {
  const reports = updateChecks.map((check) => ({
    currentVersion: check.dock.version,
    dockId: check.dock.id,
    ...(check.latestVersion === undefined ? {} : { latestVersion: check.latestVersion }),
    ...(check.error === undefined ? {} : { message: check.error }),
    ...(check.platform === undefined ? {} : { platform: check.platform }),
    status:
      check.error !== undefined
        ? ("failed" as const)
        : check.updateAvailable
          ? ("outdated" as const)
          : ("current" as const),
  }));
  return {
    reports,
    success: true,
    summary: {
      current: reports
        .filter((report) => report.status === "current")
        .map((report) => report.dockId),
      failed: reports.filter((report) => report.status === "failed").map((report) => report.dockId),
      outdated: reports
        .filter((report) => report.status === "outdated")
        .map((report) => report.dockId),
    },
    updatesAvailable: reports.some((report) => report.status === "outdated"),
  };
}

export function installedDockListCommandResult(
  cwd: string,
  options: { summary?: boolean } = {},
): JsonInstalledDockListCommandResult {
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
    docks: options.summary === true ? docks.map(installedDockSummary) : docks,
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

function installedDockSummary(dock: InstalledDockRecord): JsonInstalledDockSummary {
  const { files, ...summary } = dock;
  return {
    ...summary,
    fileCount: files.length,
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
  options: { summary?: boolean } = {},
): JsonChangeCommandResult {
  const summary = changeSummary(reports);
  if (options.summary === true) {
    const maxVisibleItems = 24;
    return {
      operation,
      reports: reports.map((report) => compactChangeReport(report, maxVisibleItems)),
      summary: compactChangeSummary(summary, maxVisibleItems),
      summaryCounts: changeSummaryCounts(reports),
      success: true,
    };
  }
  return {
    operation,
    reports,
    summary,
    success: true,
  };
}

function changeSummary(reports: JsonDockChangeReport[]): JsonChangeSummary {
  return {
    created: uniqueFlatMap(reports, (report) => report.fileChanges.created),
    deleted: uniqueFlatMap(reports, (report) => report.fileChanges.deleted),
    reviewRequired: uniqueFlatMap(reports, (report) => report.fileChanges.reviewRequired),
    unchanged: reports
      .filter((report) => report.status === "unchanged")
      .map((report) => report.dockId),
    updated: uniqueFlatMap(reports, (report) => report.fileChanges.updated),
  };
}

function changeSummaryCounts(reports: JsonDockChangeReport[]): JsonChangeSummaryCounts {
  const summary = changeSummary(reports);
  return {
    created: summary.created.length,
    deleted: summary.deleted.length,
    reviewRequired: summary.reviewRequired.length,
    unchanged: summary.unchanged.length,
    updated: summary.updated.length,
  };
}

function compactChangeSummary(
  summary: JsonChangeSummary,
  maxVisibleItems: number,
): JsonChangeSummary {
  return {
    created: summary.created.slice(0, maxVisibleItems),
    deleted: summary.deleted.slice(0, maxVisibleItems),
    reviewRequired: summary.reviewRequired.slice(0, maxVisibleItems),
    unchanged: summary.unchanged.slice(0, maxVisibleItems),
    updated: summary.updated.slice(0, maxVisibleItems),
  };
}

function compactChangeReport(
  report: JsonDockChangeReport,
  maxVisibleItems: number,
): JsonDockChangeReport {
  return {
    ...report,
    fileChanges: {
      created: report.fileChanges.created.slice(0, maxVisibleItems),
      deleted: report.fileChanges.deleted.slice(0, maxVisibleItems),
      reviewRequired: report.fileChanges.reviewRequired.slice(0, maxVisibleItems),
      updated: report.fileChanges.updated.slice(0, maxVisibleItems),
    },
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
