import type { InstallReport } from "./core/app/dock-install-report.js";
import { formatStepSymbol, terminalStyle } from "./terminal-style.js";

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
