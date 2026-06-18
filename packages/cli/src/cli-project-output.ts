import { printJson } from "./change-events.js";
import { type InstalledDockUpdateCheck, installedDockListCommandResult } from "./change-output.js";
import { resolveCliPlatform } from "./cli-options.js";
import { DockRef } from "./core/domain/manifest.js";
import { type InstalledDockRecord, OpenDockStateStore } from "./core/domain/state-store.js";
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

export function printInstalledDocks(cwd: string, json = false): void {
  if (json) {
    printJson(installedDockListCommandResult(cwd));
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
  console.log(terminalStyle.bold("OpenDock Updates"));
  console.log(`${terminalStyle.dim("Project:")} ${cwd}`);
  if (updates.length === 0) {
    console.log(terminalStyle.success("No OpenDock dock updates available."));
    return;
  }

  console.log(`${terminalStyle.bold("Updates")}:`);
  for (const check of updates) {
    console.log(formatUpdateCheckLine(check));
  }

  const current = updateChecks.filter((check) => !check.updateAvailable);
  if (current.length > 0) {
    console.log(`${terminalStyle.bold("Current")}:`);
    for (const check of current) {
      console.log(formatCurrentCheckLine(check));
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
    console.log(`Status: ${formatStatus("Ready")}`);
    console.log(`${terminalStyle.bold("Checks")}:`);
    console.log(`${formatStepSymbol("✓")} .opendock/project.yml`);
    console.log(`${formatStepSymbol("✓")} .opendock/dock.lock.yml`);
    const lock = store.readLock();
    const selectedDocks =
      dockId === undefined ? lock.docks : lock.docks.filter((dock) => dock.id === dockId);
    if (dockId !== undefined && selectedDocks.length === 0) {
      throw new Error(`dock \`${dockId}\` is not installed in this project`);
    }
    for (const dock of selectedDocks) {
      const platform = resolveCliPlatform(platformOverride ?? dock.platform);
      console.log(
        `${formatStepSymbol("✓")} ${formatDockVersion(dock.id, dock.version)} ${formatListPlatform(platform)}`,
      );
      await printDockDoctorChecks(
        cwd,
        DockRef.parse(`${dock.id}@${lockedDockVersionSelector(dock)}`),
        platform,
      );
    }
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
  )} ${formatStepSymbol("->")} ${terminalStyle.dim(check.latestVersion)} ${formatListPlatform(
    check.platform,
  )}`;
}

function formatCurrentCheckLine(check: InstalledDockUpdateCheck): string {
  return `${formatStepSymbol("✓")} ${formatDockVersion(
    check.dock.id,
    check.dock.version,
  )} ${formatListPlatform(check.platform)}`;
}

function formatManagedFileCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

async function printDockDoctorChecks(
  cwd: string,
  dockRef: DockRef,
  platform: OpenDockPlatform,
): Promise<void> {
  try {
    const resolved = await resolveDock(dockRef, platform);
    const reports = new TaskRunner().run(resolved.manifest, {
      projectDir: cwd,
      dockId: resolved.manifest.id,
      phase: "doctor",
      platform,
    }).reports;
    for (const report of reports) {
      const symbol = report.status === "Failed" ? formatStepSymbol("!") : formatStepSymbol("✓");
      const suffix = report.message ? ` (${report.message})` : "";
      console.log(`${symbol} ${report.id}${suffix}`);
    }
  } catch (error) {
    console.log(
      `${formatStepSymbol("!")} ${terminalStyle.bold(
        dockRef.id(),
      )} doctor checks unavailable: ${(error as Error).message}`,
    );
  }
}
