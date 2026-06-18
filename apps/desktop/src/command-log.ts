import type { AppLog, OpenDockCommandLine, OpenDockCommandResult } from "./data";

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
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return date.toLocaleTimeString("en-GB", { hour12: false }).slice(0, 8);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
