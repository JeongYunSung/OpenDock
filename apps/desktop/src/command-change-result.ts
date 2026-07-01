import type {
  Lang,
  OpenDockChangeReport,
  OpenDockChangeResult,
  OpenDockCommandResult,
  OpenDockOutdatedReport,
  OpenDockOutdatedResult,
  TEXT,
} from "./data";
import { nowTime } from "./command-log";
import type { CommandForceRetry, CommandTask, CommandTaskRow } from "./command-task";

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

export function successStepForChangeResult(
  result: OpenDockChangeResult | null,
  fallback: string,
  t: (typeof TEXT)[Lang],
) {
  return isNoUpdateChangeResult(result) ? t.noUpdatesAvailable : fallback;
}

export function outdatedReportsByDockId(
  value: OpenDockCommandResult["json"],
): Record<string, OpenDockOutdatedReport> {
  const result = openDockOutdatedResult(value);
  if (!result?.success) return {};
  return Object.fromEntries(result.reports.map((report) => [report.dockId, report]));
}

function isNoUpdateChangeResult(result: OpenDockChangeResult | null) {
  return result?.success === true && result.operation === "update" && result.reports.length === 0;
}

function openDockOutdatedResult(
  value: OpenDockCommandResult["json"],
): OpenDockOutdatedResult | null {
  if (!value || !("updatesAvailable" in value)) return null;
  return value;
}

function commandResultGroups(result: OpenDockChangeResult, t: (typeof TEXT)[Lang]) {
  const versionChanges = result.reports.flatMap(versionChangeLabel);
  const unchanged =
    result.summary.unchanged.length > 0
      ? result.summary.unchanged
      : result.reports.filter((report) => report.status === "unchanged").map((report) => report.dockId);
  return [
    {
      count: result.summaryCounts?.created ?? result.summary.created.length,
      items: result.summary.created,
      key: "created",
      label: t.resultAdded,
      symbol: "+",
    },
    {
      count:
        versionChanges.length +
        (result.summaryCounts?.updated ?? result.summary.updated.length),
      items: [...versionChanges, ...result.summary.updated],
      key: "updated",
      label: t.resultChanged,
      symbol: "~",
    },
    {
      count: result.summaryCounts?.deleted ?? result.summary.deleted.length,
      items: result.summary.deleted,
      key: "deleted",
      label: t.resultDeleted,
      symbol: "-",
    },
    {
      count: result.summaryCounts?.reviewRequired ?? result.summary.reviewRequired.length,
      items: result.summary.reviewRequired,
      key: "reviewRequired",
      label: t.resultReviewRequired,
      symbol: "!",
    },
    {
      count: result.summaryCounts?.unchanged ?? unchanged.length,
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
