import type {
  AppLog,
  Lang,
  OpenDockChangeReport,
  OpenDockChangeResult,
  OpenDockCommandLine,
  OpenDockCommandProgress,
  OpenDockCommandResult,
  OpenDockOutdatedReport,
  OpenDockOutdatedResult,
  TEXT,
} from "./data";

export type CommandTaskKind = "install" | "update" | "delete" | "doctor";
export type CommandTaskStatus = "running" | "cancelling" | "success" | "error" | "cancelled";

export interface CommandForceRetry {
  dockId?: string;
  kind: "delete" | "update";
  projectPath: string;
}

export interface CommandTask {
  forceRetry: CommandForceRetry | null;
  forceRetryUsed: boolean;
  id: string;
  kind: CommandTaskKind;
  projectPath?: string;
  target: string;
  progress: number;
  status: CommandTaskStatus;
  step: string;
  lines: number;
  rows: CommandTaskRow[];
  startedAt: string;
  updatedAt: string;
}

export interface CommandTaskRow {
  time: string;
  level: string;
  color: string;
  message: string;
}

export function nowTime() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false }).slice(0, 8);
}

export function logColor(level: string) {
  switch (level) {
    case "OK":
      return "var(--success)";
    case "RUN":
      return "var(--info)";
    case "WARN":
      return "var(--warning)";
    case "ERR":
      return "var(--danger)";
    default:
      return "var(--text-2)";
  }
}

export function commandLineLogEntry(line: OpenDockCommandLine): AppLog {
  const parsed = parseOpenDockHistoryLine(line.message);
  if (parsed) return parsed;
  const level = line.level.toUpperCase();
  return { time: nowTime(), level, color: logColor(level), message: line.message };
}

export function isTaskActive(task: CommandTask | null) {
  return task?.status === "running" || task?.status === "cancelling";
}

export function isTaskForTarget(
  task: CommandTask | null,
  kind: CommandTaskKind,
  target: string,
) {
  return isTaskActive(task) && task?.kind === kind && task.target.startsWith(target);
}

function commandTaskId(kind: CommandTaskKind) {
  return `opendock-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createCommandTask(
  kind: CommandTaskKind,
  target: string,
  waitingStep: string,
  projectPath?: string,
): CommandTask {
  return {
    forceRetry: null,
    forceRetryUsed: false,
    id: commandTaskId(kind),
    kind,
    ...(projectPath === undefined ? {} : { projectPath }),
    target,
    progress: 8,
    status: "running",
    step: waitingStep,
    lines: 0,
    rows: [{ time: nowTime(), level: "RUN", color: "var(--info)", message: target }],
    startedAt: nowTime(),
    updatedAt: nowTime(),
  };
}

export function commandTaskTitle(kind: CommandTaskKind, t: (typeof TEXT)[Lang]) {
  if (kind === "install") return t.taskInstalling;
  if (kind === "update") return t.taskUpdating;
  if (kind === "delete") return t.taskDeleting;
  return t.taskDoctor;
}

function nextCommandProgress(task: CommandTask, line: OpenDockCommandLine) {
  const normalizedLevel = line.level.toUpperCase();
  const bump =
    normalizedLevel === "OK" ? 18 : normalizedLevel === "RUN" ? 12 : normalizedLevel === "ERR" ? 8 : 7;
  return Math.min(92, Math.max(task.progress + bump, 12));
}

function commandTaskLevel(status: CommandTaskStatus) {
  if (status === "success") return "OK";
  if (status === "error") return "ERR";
  if (status === "cancelled" || status === "cancelling") return "WARN";
  return "RUN";
}

export function commandRowsContainMessage(rows: CommandTaskRow[], message: string) {
  const normalized = normalizeCommandRowMessage(message);
  if (!normalized) return true;
  return rows.some((row) => normalizeCommandRowMessage(row.message) === normalized);
}

export function applyCommandLineToRunningTask(
  current: CommandTask | null,
  line: OpenDockCommandLine,
): CommandTask | null {
  if (!current || current.status !== "running") return current;
  const level = line.level.toUpperCase();
  return {
    ...current,
    progress: nextCommandProgress(current, line),
    step: line.message,
    lines: current.lines + 1,
    rows: [
      { time: nowTime(), level, color: logColor(level), message: line.message },
      ...current.rows,
    ].slice(0, 20),
    updatedAt: nowTime(),
  };
}

export function applyCommandProgressToRunningTask(
  current: CommandTask | null,
  progress: OpenDockCommandProgress,
): CommandTask | null {
  if (!current || current.status !== "running") return current;
  if (progress.commandId && progress.commandId !== current.id) return current;
  const level = progress.level.toUpperCase();
  const percent = Number.isFinite(progress.percent)
    ? Math.max(current.progress, Math.min(100, progress.percent))
    : current.progress;
  const row = { time: nowTime(), level, color: logColor(level), message: progress.message };
  const suppressProgressRow = isNoUpdateProgress(progress);
  const shouldAddRow =
    !suppressProgressRow &&
    (current.rows[0]?.message !== progress.message || current.rows[0]?.level !== level);
  return {
    ...current,
    progress: percent,
    step: suppressProgressRow ? current.step : progress.message,
    lines: current.lines + 1,
    rows: shouldAddRow ? [row, ...current.rows].slice(0, 20) : current.rows,
    updatedAt: nowTime(),
  };
}

export function finishCommandTaskState(
  current: CommandTask | null,
  commandId: string,
  status: Exclude<CommandTaskStatus, "running" | "cancelling">,
  step: string,
  options: { forceRetry?: CommandForceRetry | null } = {},
): CommandTask | null {
  if (!current || current.id !== commandId) return current;
  const hasSpecificError = status === "error" && current.rows.some((row) => row.level === "ERR" && row.message !== step);
  const nextRows =
    current.step === step || hasSpecificError
      ? current.rows
      : [
          { time: nowTime(), level: commandTaskLevel(status), color: logColor(commandTaskLevel(status)), message: step },
          ...current.rows,
        ].slice(0, 20);
  return {
    ...current,
    forceRetry: options.forceRetry === undefined ? current.forceRetry : options.forceRetry,
    progress: status === "success" ? 100 : current.progress,
    status,
    step,
    rows: nextRows,
    updatedAt: nowTime(),
  };
}

export function markCommandTaskCancelling(
  current: CommandTask | null,
  commandId: string,
  step: string,
): CommandTask | null {
  if (!current || current.id !== commandId) return current;
  return {
    ...current,
    status: "cancelling",
    step,
    rows: [
      { time: nowTime(), level: "WARN", color: "var(--warning)", message: step },
      ...current.rows,
    ].slice(0, 20),
    updatedAt: nowTime(),
  };
}

export function markCommandTaskForceRetrying(
  current: CommandTask | null,
  commandId: string,
  step: string,
): CommandTask | null {
  if (!current || current.id !== commandId) return current;
  return {
    ...current,
    forceRetry: null,
    forceRetryUsed: true,
    progress: 12,
    status: "running",
    step,
    rows: [
      { time: nowTime(), level: "WARN", color: logColor("WARN"), message: step },
      ...current.rows,
    ].slice(0, 20),
    updatedAt: nowTime(),
  };
}

export function appendCommandTaskRows(
  current: CommandTask | null,
  commandId: string,
  rows: CommandTaskRow[],
): CommandTask | null {
  if (!current || current.id !== commandId || rows.length === 0) return current;
  return {
    ...current,
    rows: [...rows, ...current.rows].slice(0, 20),
    updatedAt: nowTime(),
  };
}

export function commandForceRetryFor(
  task: CommandTask,
  result: OpenDockChangeResult | null,
): CommandForceRetry | null {
  if (!result?.forceable || task.forceRetryUsed) return null;
  if (task.kind === "update") {
    return { kind: "update", projectPath: task.projectPath ?? task.target };
  }
  if (task.kind === "delete" && task.projectPath) {
    return { dockId: task.target, kind: "delete", projectPath: task.projectPath };
  }
  return null;
}

export function commandFailureMessage(result: OpenDockCommandResult, fallback: string) {
  return (
    result.stderr.trim().split("\n").find(Boolean) ??
    result.stdout.trim().split("\n").find(Boolean) ??
    result.lines.find((line) => line.message.trim())?.message ??
    fallback
  );
}

export function isAuthStatusLine(message: string) {
  return (
    message.startsWith("Opening browser") ||
    message.startsWith("Open this URL") ||
    message.startsWith("Browser did not open") ||
    message.startsWith("Waiting for login") ||
    message.startsWith("Logged in as")
  );
}

export function waitForCommandPopupPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      window.setTimeout(resolve, 0);
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

export function commandResultRows(
  result: OpenDockChangeResult,
  t: (typeof TEXT)[Lang],
): CommandTaskRow[] {
  const rows: CommandTaskRow[] = [];
  for (const group of commandResultGroups(result, t).filter((item) => item.items.length > 0)) {
    const color = commandResultColor(group.symbol);
    rows.push({
      time: nowTime(),
      level: group.symbol,
      color,
      message: `${group.label} ${group.count}`,
    });
    const visibleItems = visibleChangeItems(group.items);
    for (const item of visibleItems) {
      rows.push({
        time: nowTime(),
        level: group.symbol,
        color,
        message: item,
      });
    }
    if (group.items.length > visibleItems.length) {
      rows.push({
        time: nowTime(),
        level: group.symbol,
        color,
        message: `... +${group.items.length - visibleItems.length}`,
      });
    }
  }
  return rows;
}

export function openDockChangeResult(
  value: OpenDockCommandResult["json"],
): OpenDockChangeResult | null {
  if (!value || !("operation" in value)) return null;
  return value;
}

function isNoUpdateChangeResult(result: OpenDockChangeResult | null) {
  return result?.success === true && result.operation === "update" && result.reports.length === 0;
}

function isNoUpdateProgress(progress: OpenDockCommandProgress) {
  return (
    progress.operation === "update" &&
    progress.phase === "complete" &&
    progress.level.toUpperCase() === "OK" &&
    progress.message === "No OpenDock dock updates available."
  );
}

export function successStepForChangeResult(
  result: OpenDockChangeResult | null,
  fallback: string,
  t: (typeof TEXT)[Lang],
) {
  return isNoUpdateChangeResult(result) ? t.noUpdatesAvailable : fallback;
}

function openDockOutdatedResult(
  value: OpenDockCommandResult["json"],
): OpenDockOutdatedResult | null {
  if (!value || !("updatesAvailable" in value)) return null;
  return value;
}

export function outdatedReportsByDockId(
  value: OpenDockCommandResult["json"],
): Record<string, OpenDockOutdatedReport> {
  const result = openDockOutdatedResult(value);
  if (!result?.success) return {};
  return Object.fromEntries(result.reports.map((report) => [report.dockId, report]));
}

function parseOpenDockHistoryLine(message: string): AppLog | null {
  const match = message.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+(\S+)\s+(.+)$/);
  if (!match) return null;
  const [, isoTime, status, body] = match;
  const level = logLevelForHistoryStatus(status);
  return {
    time: formatHistoryTime(isoTime),
    level,
    color: logColor(level),
    message: body,
  };
}

function logLevelForHistoryStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "success") return "OK";
  if (normalized === "warning" || normalized === "warn") return "WARN";
  if (normalized === "running" || normalized === "run") return "RUN";
  if (normalized === "failed" || normalized === "failure" || normalized === "error") return "ERR";
  return "INFO";
}

function formatHistoryTime(isoTime: string) {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return nowTime();
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return date.toLocaleTimeString("en-GB", { hour12: false }).slice(0, 8);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function normalizeCommandRowMessage(message: string) {
  return message.trim().replace(/\s+/g, " ");
}

function commandResultGroups(result: OpenDockChangeResult, t: (typeof TEXT)[Lang]) {
  const versionChanges = result.reports.flatMap(versionChangeLabel);
  const unchanged =
    result.summary.unchanged.length > 0
      ? result.summary.unchanged
      : result.reports.filter((report) => report.status === "unchanged").map((report) => report.dockId);
  return [
    {
      count: result.summary.created.length,
      items: result.summary.created,
      key: "created",
      label: t.resultAdded,
      symbol: "+",
    },
    {
      count: versionChanges.length + result.summary.updated.length,
      items: [...versionChanges, ...result.summary.updated],
      key: "updated",
      label: t.resultChanged,
      symbol: "~",
    },
    {
      count: result.summary.deleted.length,
      items: result.summary.deleted,
      key: "deleted",
      label: t.resultDeleted,
      symbol: "-",
    },
    {
      count: result.summary.reviewRequired.length,
      items: result.summary.reviewRequired,
      key: "reviewRequired",
      label: t.resultReviewRequired,
      symbol: "!",
    },
    {
      count: unchanged.length,
      items: unchanged,
      key: "unchanged",
      label: t.resultNoChanges,
      symbol: "=",
    },
  ];
}

function commandResultColor(symbol: string) {
  if (symbol === "+") return "var(--success)";
  if (symbol === "~") return "var(--info)";
  if (symbol === "-") return "var(--danger)";
  if (symbol === "!") return "var(--warning)";
  return "var(--text-3)";
}

function versionChangeLabel(report: OpenDockChangeReport) {
  if (report.operation !== "update") return [];
  if (report.fromVersion && report.toVersion && report.fromVersion !== report.toVersion) {
    return [`${report.dockId} ${report.fromVersion} -> ${report.toVersion}`];
  }
  if (report.status === "updated" && report.fromVersion) {
    return [`${report.dockId} ${report.fromVersion} -> ${report.version}`];
  }
  return [];
}

function visibleChangeItems(items: string[]) {
  return items.slice(0, 8);
}
