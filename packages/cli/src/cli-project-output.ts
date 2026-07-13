import { printJson } from "./change-events.js";
import { type InstalledDockUpdateCheck, installedDockListCommandResult } from "./change-output.js";
import { resolveCliPlatform } from "./cli-options.js";
import { DockRef } from "./core/domain/manifest.js";
import { type InstalledDockRecord, OpenDockStateStore } from "./core/domain/state-store.js";
import { FilePlan } from "./core/files/file-plan.js";
import { DependencyRunner } from "./core/runtime/dependency-runner.js";
import { TaskRunner } from "./core/runtime/task-runner.js";
import { lockedDockVersionSelector } from "./installed-dock-updates.js";
import type { OpenDockPlatform } from "./platform.js";
import { resolveDock } from "./resolver.js";
import {
  formatDockVersion,
  formatListPlatform,
  formatStatus,
  formatStepSymbol,
  terminalStyle,
} from "./terminal-style.js";

export function readInstalledDocks(cwd: string): InstalledDockRecord[] | undefined {
  const store = new OpenDockStateStore(cwd);
  if (!store.hasState()) {
    return undefined;
  }
  return store.readLock().docks;
}

export function printInstalledDocks(
  cwd: string,
  json = false,
  options: { summary?: boolean } = {},
): void {
  if (json) {
    printJson(installedDockListCommandResult(cwd, { summary: options.summary === true }));
    return;
  }

  const docks = readInstalledDocks(cwd);
  if (docks === undefined) {
    console.log(terminalStyle.dim("No OpenDock docks installed in this project."));
    return;
  }

  if (docks.length === 0) {
    console.log(terminalStyle.dim("No OpenDock docks installed in this project."));
    return;
  }

  console.log(terminalStyle.bold("OpenDock Docks"));
  console.log(`${terminalStyle.dim("Project:")} ${cwd}`);
  console.log(`${terminalStyle.bold("Installed")}:`);
  for (const dock of docks) {
    console.log(formatInstalledDockLine(dock));
  }
}

export function printUpdateChecks(cwd: string, updateChecks: InstalledDockUpdateCheck[]): void {
  const updates = updateChecks.filter((check) => check.updateAvailable);
  const failed = updateChecks.filter((check) => check.error !== undefined);
  console.log(terminalStyle.bold("OpenDock Updates"));
  console.log(`${terminalStyle.dim("Project:")} ${cwd}`);
  if (updates.length === 0 && failed.length === 0) {
    console.log(terminalStyle.success("No OpenDock dock updates available."));
    return;
  }

  if (updates.length > 0) {
    console.log(`${terminalStyle.bold("Updates")}:`);
    for (const check of updates) {
      console.log(formatUpdateCheckLine(check));
    }
  }

  const current = updateChecks.filter(
    (check) => !check.updateAvailable && check.error === undefined,
  );
  if (current.length > 0) {
    console.log(`${terminalStyle.bold("Current")}:`);
    for (const check of current) {
      console.log(formatCurrentCheckLine(check));
    }
  }

  if (failed.length > 0) {
    console.log(`${terminalStyle.bold("Unavailable")}:`);
    for (const check of failed) {
      console.log(formatFailedCheckLine(check));
    }
  }
}

export async function printDoctor(
  cwd: string,
  platformOverride?: string,
  dockId?: string,
): Promise<void> {
  console.log(terminalStyle.bold("OpenDock Doctor"));
  console.log(`${terminalStyle.dim("Project:")} ${cwd}`);

  const store = new OpenDockStateStore(cwd);
  if (store.hasState()) {
    console.log(`${terminalStyle.bold("Checks")}:`);
    console.log(`${formatStepSymbol("✓")} .opendock/project.yml`);
    console.log(`${formatStepSymbol("✓")} .opendock/dock.lock.yml`);
    const lock = store.readLock();
    const selectedDocks =
      dockId === undefined ? lock.docks : lock.docks.filter((dock) => dock.id === dockId);
    if (dockId !== undefined && selectedDocks.length === 0) {
      throw new Error(`dock \`${dockId}\` is not installed in this project`);
    }
    let failedChecks = 0;
    for (const dock of selectedDocks) {
      const platform = resolveCliPlatform(platformOverride ?? dock.platform);
      console.log(
        `${formatStepSymbol("✓")} ${formatDockVersion(dock.id, dock.version)} ${formatListPlatform(platform)}`,
      );
      failedChecks += printManagedFileDoctorCheck(cwd, dock);
      failedChecks += await printDockDoctorChecks(
        cwd,
        DockRef.parse(`${dock.id}@${lockedDockVersionSelector(dock)}`),
        platform,
      );
    }
    if (failedChecks > 0) {
      console.log(`Status: ${formatStatus("Failed")}`);
      throw new Error(`doctor found ${failedChecks} failed check${failedChecks === 1 ? "" : "s"}`);
    }
    console.log(`Status: ${formatStatus("Ready")}`);
  } else {
    console.log(`Status: ${formatStatus("Not installed")}`);
    console.log(`${terminalStyle.bold("Checks")}:`);
    console.log(`${formatStepSymbol("!")} .opendock/project.yml missing`);
    console.log(`${formatStepSymbol("!")} .opendock/dock.lock.yml missing`);
    if (dockId !== undefined) {
      throw new Error(`dock \`${dockId}\` is not installed in this project`);
    }
  }
}

function printManagedFileDoctorCheck(cwd: string, dock: InstalledDockRecord): number {
  try {
    new FilePlan(cwd, dock.id, dock.files, false).verifyPriorState();
    console.log(`${formatStepSymbol("✓")} ${dock.id} managed files`);
    return 0;
  } catch (error) {
    console.log(
      `${formatStepSymbol("!")} ${terminalStyle.bold(dock.id)} managed files (${(error as Error).message})`,
    );
    return 1;
  }
}

function formatInstalledDockLine(dock: InstalledDockRecord): string {
  const requested = dock.requested?.trim();
  const requestedSuffix =
    requested !== undefined && requested !== "" && requested !== dock.version
      ? `, requested ${requested}`
      : "";
  return `${terminalStyle.dim("-")} ${formatDockVersion(dock.id, dock.version)} ${formatListPlatform(
    dock.platform,
  )} (${terminalStyle.info(formatManagedFileCount(dock.files.length))}${requestedSuffix})`;
}

function formatUpdateCheckLine(check: InstalledDockUpdateCheck): string {
  return `${formatStepSymbol("~")} ${terminalStyle.bold(check.dock.id)}: ${terminalStyle.dim(
    check.dock.version,
  )} ${formatStepSymbol("->")} ${terminalStyle.dim(check.latestVersion ?? "unknown")} ${formatCheckPlatform(
    check,
  )}`;
}

function formatCurrentCheckLine(check: InstalledDockUpdateCheck): string {
  return `${formatStepSymbol("✓")} ${formatDockVersion(
    check.dock.id,
    check.dock.version,
  )} ${formatCheckPlatform(check)}`;
}

function formatFailedCheckLine(check: InstalledDockUpdateCheck): string {
  return `${formatStepSymbol("!")} ${terminalStyle.bold(check.dock.id)}: ${terminalStyle.dim(
    check.error ?? "update check unavailable",
  )}`;
}

function formatCheckPlatform(check: InstalledDockUpdateCheck): string {
  return check.platform === undefined ? "" : formatListPlatform(check.platform);
}

function formatManagedFileCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

async function printDockDoctorChecks(
  cwd: string,
  dockRef: DockRef,
  platform: OpenDockPlatform,
): Promise<number> {
  try {
    const resolved = await resolveDock(dockRef, platform);
    const taskReports = new TaskRunner().run(resolved.manifest, {
      projectDir: cwd,
      dockId: resolved.manifest.id,
      phase: "doctor",
      platform,
    }).reports;
    const dependencyReports = new DependencyRunner().run(resolved.manifest, {
      projectDir: cwd,
      dockId: resolved.manifest.id,
      phase: "doctor",
      platform,
    }).reports;
    const reports = [...taskReports, ...dependencyReports];
    let failedChecks = 0;
    for (const report of reports) {
      if (report.status === "Failed") {
        failedChecks += 1;
      }
      const symbol = report.status === "Failed" ? formatStepSymbol("!") : formatStepSymbol("✓");
      const suffix = report.message ? ` (${report.message})` : "";
      console.log(`${symbol} ${report.id}${suffix}`);
    }
    return failedChecks;
  } catch (error) {
    console.log(
      `${formatStepSymbol("!")} ${terminalStyle.bold(
        dockRef.id(),
      )} doctor checks unavailable: ${(error as Error).message}`,
    );
    return 1;
  }
}
