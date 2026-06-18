import type {
  AppLog,
  Lang,
  OpenDockChangeReport,
  OpenDockChangeResult,
  OpenDockCommandLine,
  OpenDockCommandResult,
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

export function commandTaskId(kind: CommandTaskKind) {
  return `opendock-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function commandTaskTitle(kind: CommandTaskKind, t: (typeof TEXT)[Lang]) {
  if (kind === "install") return t.taskInstalling;
  if (kind === "update") return t.taskUpdating;
  if (kind === "delete") return t.taskDeleting;
  return t.taskDoctor;
}

export function nextCommandProgress(task: CommandTask, line: OpenDockCommandLine) {
  const normalizedLevel = line.level.toUpperCase();
  const bump =
    normalizedLevel === "OK" ? 18 : normalizedLevel === "RUN" ? 12 : normalizedLevel === "ERR" ? 8 : 7;
  return Math.min(92, Math.max(task.progress + bump, 12));
}

export function commandTaskLevel(status: CommandTaskStatus) {
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

export function statusLabel(status: CommandTaskStatus, t: (typeof TEXT)[Lang]) {
  if (status === "success") return t.taskCompleted;
  if (status === "error") return t.taskFailed;
  if (status === "cancelled") return t.taskCancelled;
  if (status === "cancelling") return t.taskCancelling;
  return t.taskWorking;
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
