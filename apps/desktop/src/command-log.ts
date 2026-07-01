import type { AppLog, OpenDockCommandLine, OpenDockCommandResult } from "./data";

const MAX_STORED_LOGS = 400;

export function nowTime() {
  return formatLogTime(new Date());
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

function commandLineLogEntry(line: OpenDockCommandLine): AppLog {
  const parsed = parseOpenDockHistoryLine(line.message);
  if (parsed) return parsed;
  const level = line.level.toUpperCase();
  return { time: nowTime(), level, color: logColor(level), message: line.message };
}

export function normalizeStoredLogs(value: unknown, fallback: AppLog[]) {
  return Array.isArray(value) ? value.slice(-MAX_STORED_LOGS) : fallback;
}

export function appendStoredLog(current: AppLog[], level: string, color: string, message: string) {
  return [
    ...current.slice(Math.max(0, current.length - (MAX_STORED_LOGS - 1))),
    { time: nowTime(), level, color, message },
  ];
}

export function commandLinesToStoredLogs(lines: OpenDockCommandLine[]) {
  return lines.slice(-MAX_STORED_LOGS).map(commandLineLogEntry);
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
  return formatLogTime(date);
}

function formatLogTime(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-") + ` ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}
