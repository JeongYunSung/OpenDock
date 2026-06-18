import type {
  Lang,
  OpenDockCommandLine,
  OpenDockCommandProgress,
  TEXT,
} from "./data";
import { logColor, nowTime } from "./command-log";

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

function isNoUpdateProgress(progress: OpenDockCommandProgress) {
  return (
    progress.operation === "update" &&
    progress.phase === "complete" &&
    progress.level.toUpperCase() === "OK" &&
    progress.message === "No OpenDock dock updates available."
  );
}

function normalizeCommandRowMessage(message: string) {
  return message.trim().replace(/\s+/g, " ");
}
