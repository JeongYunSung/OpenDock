import { type ChangeEventReporter, createChangeEventReporter, printJson } from "./change-events.js";
import type {
  FileChangeDetails,
  InstallReport,
  UninstallReport,
} from "./core/app/dock-installer.js";
import { type InstalledDockRecord, OpenDockStateStore } from "./core/domain/state-store.js";
import type { OpenDockPlatform } from "./platform.js";
import { formatStepSymbol, terminalStyle } from "./terminal-style.js";

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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export function formatFileSummary(report: InstallReport): string {
  return `${formatFileCount(report.filesCreated, "files created", "created")}, ${formatFileCount(
    report.filesUpdated,
    "files updated",
    "updated",
  )}, ${formatFileCount(report.filesDeleted, "files deleted", "deleted")}, ${formatFileCount(
    report.filesReviewRequired,
    "review required",
    "review",
  )}`;
}

export function plainInstallFileSummary(report: InstallReport): string {
  return `${report.filesCreated} files created, ${report.filesUpdated} files updated, ${report.filesDeleted} files deleted, ${report.filesReviewRequired} review required`;
}

export function formatFileCount(
  count: number,
  label: string,
  tone: "created" | "deleted" | "review" | "updated",
): string {
  const value = `${count} ${label}`;
  if (count === 0) {
    return terminalStyle.dim(value);
  }
  switch (tone) {
    case "created":
      return terminalStyle.created(value);
    case "updated":
      return terminalStyle.updated(value);
    case "deleted":
      return terminalStyle.deleted(value);
    case "review":
      return terminalStyle.review(value);
  }
}

export function printFileChanges(report: InstallReport): void {
  const groups = [
    { label: "created", paths: report.fileChanges.created, symbol: "+" },
    { label: "updated", paths: report.fileChanges.updated, symbol: "~" },
    { label: "deleted", paths: report.fileChanges.deleted, symbol: "-" },
    { label: "review required", paths: report.fileChanges.reviewRequired, symbol: "!" },
  ];
  if (groups.every((group) => group.paths.length === 0)) {
    return;
  }

  console.log(`${terminalStyle.bold("Files")}:`);
  for (const group of groups) {
    printFileChangeGroup(group.symbol, group.paths, group.label);
  }
}

function printFileChangeGroup(symbol: string, paths: string[], label: string): void {
  const maxVisiblePaths = 12;
  for (const path of paths.slice(0, maxVisiblePaths)) {
    console.log(`  ${formatFileChangeSymbol(symbol)} ${path}`);
  }
  const hiddenCount = paths.length - maxVisiblePaths;
  if (hiddenCount > 0) {
    console.log(
      `  ${formatFileChangeSymbol(symbol)} ${terminalStyle.dim(
        `... and ${hiddenCount} more ${label}`,
      )}`,
    );
  }
}

function formatFileChangeSymbol(symbol: string): string {
  switch (symbol) {
    case "+":
      return formatStepSymbol("+");
    case "~":
      return formatStepSymbol("~");
    case "-":
      return formatStepSymbol("-");
    case "!":
      return formatStepSymbol("!");
    default:
      return symbol;
  }
}
