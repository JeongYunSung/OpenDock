import { useRef, useState } from "react";
import {
  appendCommandTaskRows,
  applyCommandLineToRunningTask,
  applyCommandProgressToRunningTask,
  commandRowsContainMessage,
  createCommandTask,
  finishCommandTaskState,
  isTaskActive,
  type CommandForceRetry,
  type CommandTask,
  type CommandTaskKind,
  type CommandTaskRow,
  type CommandTaskStatus,
} from "./command-task";
import { logColor, nowTime } from "./command-log";
import {
  commandForceRetryFor,
  commandResultRows,
  openDockChangeResult,
  successStepForChangeResult,
} from "./command-change-result";
import type {
  Lang,
  OpenDockChangeResult,
  OpenDockCommandLine,
  OpenDockCommandProgress,
  OpenDockCommandResult,
  TEXT,
} from "./data";

type NextCommandTask = CommandTask | null | ((current: CommandTask | null) => CommandTask | null);

export function useCommandTaskController(t: (typeof TEXT)[Lang]) {
  const [commandTask, setCommandTaskState] = useState<CommandTask | null>(null);
  const commandTaskRef = useRef<CommandTask | null>(null);

  function setCommandTask(next: NextCommandTask) {
    const value = typeof next === "function" ? next(commandTaskRef.current) : next;
    commandTaskRef.current = value;
    setCommandTaskState(value);
  }

  function beginCommandTask(kind: CommandTaskKind, target: string, projectPath?: string) {
    const task = createCommandTask(kind, target, t.taskWaiting, projectPath);
    setCommandTask(task);
    return task.id;
  }

  function applyCommandLineToTask(line: OpenDockCommandLine) {
    setCommandTask((current) => applyCommandLineToRunningTask(current, line));
  }

  function applyCommandProgressToTask(progress: OpenDockCommandProgress) {
    setCommandTask((current) => applyCommandProgressToRunningTask(current, progress));
  }

  function finishCommandTask(
    commandId: string,
    status: Exclude<CommandTaskStatus, "running" | "cancelling">,
    step: string,
    options: { forceRetry?: CommandForceRetry | null } = {},
  ) {
    setCommandTask((current) => finishCommandTaskState(current, commandId, status, step, options));
  }

  function closeCommandProgress() {
    setCommandTask((current) => (isTaskActive(current) ? current : null));
  }

  function finishCommandResult(commandId: string, result: OpenDockCommandResult, successStep: string) {
    const changeResult = openDockChangeResult(result.json);
    if (result.success) {
      appendCommandResultLog(commandId, changeResult);
      finishCommandTask(commandId, "success", successStepForChangeResult(changeResult, successStep, t), { forceRetry: null });
      return true;
    }
    const current = commandTaskRef.current;
    appendCommandFailureLog(commandId, changeResult);
    const forceRetry = current ? commandForceRetryFor(current, changeResult) : null;
    finishCommandTask(
      commandId,
      current?.id === commandId && current.status === "cancelling" ? "cancelled" : "error",
      current?.id === commandId && current.status === "cancelling" ? t.taskCancelled : t.taskFailed,
      { forceRetry },
    );
    return false;
  }

  function appendCommandResultLog(commandId: string, result: OpenDockChangeResult | null) {
    if (!result) return;
    const rows = commandResultRows(result, t);
    if (rows.length === 0) return;
    setCommandTask((current) => appendCommandTaskRows(current, commandId, rows));
  }

  function appendCommandFailureLog(commandId: string, result: OpenDockChangeResult | null) {
    if (!result || result.success) return;
    const rows: CommandTaskRow[] = [];
    const currentRows = commandTaskRef.current?.id === commandId ? commandTaskRef.current.rows : [];
    if (result.message && !commandRowsContainMessage(currentRows, result.message)) {
      rows.push({ time: nowTime(), level: "ERR", color: logColor("ERR"), message: result.message });
    }
    if (result.forceable) {
      rows.push({ time: nowTime(), level: "WARN", color: logColor("WARN"), message: t.forceRetryWarning });
    }
    if (rows.length === 0) return;
    setCommandTask((current) => appendCommandTaskRows(current, commandId, rows));
  }

  return {
    applyCommandLineToTask,
    applyCommandProgressToTask,
    appendCommandResultLog,
    beginCommandTask,
    closeCommandProgress,
    commandTask,
    commandTaskRef,
    finishCommandResult,
    finishCommandTask,
    setCommandTask,
  };
}
