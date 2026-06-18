import type { Command } from "commander";
import {
  changeCommandOutputMode,
  createChangeEventReporter,
  optionalDockEventDetails,
  printJson,
  runMaybeQuiet,
  runMaybeQuietAsync,
  runtimeProgressReporter,
  updateNestedProgressPercent,
  updateProgressPercent,
} from "./change-events.js";
import {
  formatFileCount,
  formatFileSummary,
  plainInstallFileSummary,
  printFileChanges,
} from "./change-file-output.js";
import {
  changeCommandResult,
  handleChangeCommandError,
  installChangeReport,
  type JsonDockChangeReport,
  totalFileChanges,
  uninstallChangeReport,
} from "./change-output.js";
import { recordCommandFailure, recordCommandLog } from "./cli-command-log.js";
import {
  dockIdFromReference,
  parseInstalledDockId,
  parseInstallRef,
  resolveCliPlatform,
} from "./cli-options.js";
import { DockInstaller } from "./core/app/dock-installer.js";
import { DockRef } from "./core/domain/manifest.js";
import { OpenDockStateStore } from "./core/domain/state-store.js";
import { checkInstalledDockUpdates } from "./installed-dock-updates.js";
import {
  formatDockVersion,
  formatPlatformName,
  formatStepSymbol,
  terminalStyle,
} from "./terminal-style.js";

interface ChangeCommandOptions {
  events?: boolean;
  force?: boolean;
  json?: boolean;
  platform?: string;
}

export function registerChangeCommands(program: Command): void {
  const installer = new DockInstaller();
  program
    .command("install")
    .description("Install an approved dock into the current directory.")
    .argument("<dock>", "Dock reference: owner/name@version")
    .option("--force", "Overwrite user-edited managed files")
    .option("--platform <platform>", "Target platform: macos, windows, or linux")
    .option("--json", "Print a machine-readable change report")
    .option("--events", "Print machine-readable progress events")
    .action(async (dock: string, options: ChangeCommandOptions) => {
      let dockId = dockIdFromReference(dock);
      const outputMode = changeCommandOutputMode(options);
      const events = createChangeEventReporter("install", options.events === true);
      try {
        events.progress("prepare", "Preparing install", 8, optionalDockEventDetails(dockId));
        const platform = resolveCliPlatform(options.platform);
        const dockRef = parseInstallRef(dock);
        dockId = dockRef.id();
        const report = await runMaybeQuietAsync(outputMode.machine, () =>
          installer.install({
            dockRef,
            force: options.force === true,
            live: !outputMode.machine,
            projectDir: process.cwd(),
            progress: runtimeProgressReporter(events),
            runTasks: true,
            phase: "install",
            platform,
          }),
        );
        events.progress("record", `Recording ${report.dockId}@${report.version}`, 96, {
          dockId: report.dockId,
          level: "OK",
          version: report.version,
        });
        recordCommandLog(
          process.cwd(),
          "install",
          "Success",
          `${report.dockId}@${report.version} installed (${plainInstallFileSummary(report)})`,
          report.dockId,
        );
        const result = changeCommandResult("install", [
          installChangeReport(report, { operation: "install", status: "installed" }),
        ]);
        events.result(result);
        if (options.events === true) {
          return;
        }
        if (options.json === true) {
          printJson(result);
          return;
        }
        console.log(
          `${terminalStyle.success("Installed")} ${formatDockVersion(
            report.dockId,
            report.version,
          )} for ${formatPlatformName(report.platform)} (${formatFileSummary(report)})`,
        );
        printFileChanges(report);
      } catch (error) {
        recordCommandFailure(process.cwd(), "install", error, dockId);
        handleChangeCommandError("install", error, options.json === true, events);
      }
    });

  program
    .command("update")
    .description("Update the dock installed in the current directory.")
    .option("--force", "Overwrite user-edited managed files")
    .option("--platform <platform>", "Override the platform recorded in .opendock/dock.lock.yml")
    .option("--json", "Print a machine-readable change report")
    .option("--events", "Print machine-readable progress events")
    .action(async (options: ChangeCommandOptions) => {
      const outputMode = changeCommandOutputMode(options);
      const events = createChangeEventReporter("update", options.events === true);
      try {
        events.progress("prepare", "Preparing update", 8);
        const platformOverride =
          options.platform === undefined ? undefined : resolveCliPlatform(options.platform);
        const store = new OpenDockStateStore(process.cwd());
        if (!store.hasState()) {
          throw new Error(".opendock/dock.lock.yml missing");
        }
        const installedDocks = store.readLock().docks;
        if (installedDocks.length === 0) {
          throw new Error("no OpenDock docks are installed in this project");
        }
        events.progress("check", `Checking ${installedDocks.length} installed dock(s)`, 24, {
          current: 0,
          total: installedDocks.length,
        });
        const updateChecks = await checkInstalledDockUpdates(installedDocks, platformOverride);
        const updateTargets = updateChecks.filter((check) => check.updateAvailable);
        if (updateTargets.length === 0) {
          recordCommandLog(
            process.cwd(),
            "update",
            "Skipped",
            `no updates available for ${installedDocks.length} installed dock(s)`,
          );
          const result = changeCommandResult("update", []);
          events.progress("complete", "No OpenDock dock updates available.", 100, {
            level: "OK",
            total: 0,
          });
          events.result(result);
          if (options.events === true) {
            return;
          }
          if (options.json === true) {
            printJson(result);
          } else {
            console.log(terminalStyle.success("No OpenDock dock updates available."));
          }
          return;
        }
        const changeReports: JsonDockChangeReport[] = [];
        events.progress("plan", `Found ${updateTargets.length} update(s)`, 36, {
          current: 0,
          total: updateTargets.length,
        });
        for (const [index, updateTarget] of updateTargets.entries()) {
          const dock = updateTarget.dock;
          const dockRef = DockRef.parse(`${dock.id}@${updateTarget.latestVersion}`);
          const current = index + 1;
          events.progress(
            "target-start",
            `Updating ${dock.id}: ${dock.version} -> ${updateTarget.latestVersion}`,
            updateProgressPercent(index, updateTargets.length, 0.15),
            {
              current,
              dockId: dock.id,
              total: updateTargets.length,
              version: updateTarget.latestVersion,
            },
          );
          const report = await runMaybeQuietAsync(outputMode.machine, () =>
            installer.install({
              dockRef,
              force: options.force === true,
              live: !outputMode.machine,
              projectDir: process.cwd(),
              progress: runtimeProgressReporter(events, (percent) =>
                updateNestedProgressPercent(index, updateTargets.length, percent),
              ),
              runTasks: true,
              phase: "update",
              platform: updateTarget.platform,
            }),
          );
          changeReports.push(
            installChangeReport(report, {
              fromVersion: dock.version,
              operation: "update",
              status:
                dock.version === report.version && totalFileChanges(report.fileChanges) === 0
                  ? "unchanged"
                  : "updated",
            }),
          );
          events.progress(
            "updated",
            `Updated ${report.dockId}@${report.version}`,
            updateProgressPercent(index, updateTargets.length, 0.98),
            {
              current,
              dockId: report.dockId,
              level: "OK",
              total: updateTargets.length,
              version: report.version,
            },
          );
          if (outputMode.machine) {
            continue;
          }
          if (dock.version === report.version) {
            console.log(
              `${terminalStyle.success("Updated")} ${terminalStyle.bold(
                dock.id,
              )} at latest ${terminalStyle.dim(report.version)} for ${formatPlatformName(
                report.platform,
              )} (${formatFileSummary(report)})`,
            );
          } else {
            console.log(
              `${terminalStyle.success("Updated")} ${terminalStyle.bold(dock.id)}: ${terminalStyle.dim(
                dock.version,
              )} ${formatStepSymbol("->")} ${terminalStyle.dim(
                report.version,
              )} for ${formatPlatformName(report.platform)} (${formatFileSummary(report)})`,
            );
          }
          printFileChanges(report);
        }
        recordCommandLog(
          process.cwd(),
          "update",
          "Success",
          `updated ${changeReports.length} dock(s): ${changeReports
            .map((report) => `${report.dockId}@${report.version}`)
            .join(", ")}`,
        );
        events.progress("record", `Recorded ${changeReports.length} update(s)`, 94, {
          level: "OK",
          total: changeReports.length,
        });
        const result = changeCommandResult("update", changeReports);
        events.result(result);
        if (options.events === true) {
          return;
        }
        if (options.json === true) {
          printJson(result);
        }
      } catch (error) {
        recordCommandFailure(process.cwd(), "update", error);
        handleChangeCommandError("update", error, options.json === true, events);
      }
    });

  program
    .command("uninstall")
    .description("Remove an installed dock from the current directory.")
    .argument("<dock>", "Installed dock id: owner/name")
    .option("--force", "Remove OpenDock-managed files even when edited managed files are detected")
    .option("--json", "Print a machine-readable change report")
    .option("--events", "Print machine-readable progress events")
    .action((dock: string, options: Pick<ChangeCommandOptions, "events" | "force" | "json">) => {
      let dockId = dockIdFromReference(dock);
      const outputMode = changeCommandOutputMode(options);
      const events = createChangeEventReporter("uninstall", options.events === true);
      try {
        events.progress("prepare", "Preparing uninstall", 8, optionalDockEventDetails(dockId));
        const parsedDockId = parseInstalledDockId(dock);
        dockId = parsedDockId;
        const report = runMaybeQuiet(outputMode.machine, () =>
          installer.uninstall({
            dockId: parsedDockId,
            force: options.force === true,
            progress: runtimeProgressReporter(events),
            projectDir: process.cwd(),
          }),
        );
        events.progress("record", `Recording uninstall ${report.dockId}@${report.version}`, 96, {
          dockId: report.dockId,
          level: "OK",
          version: report.version,
        });
        recordCommandLog(
          process.cwd(),
          "uninstall",
          "Success",
          `${report.dockId}@${report.version} uninstalled (${report.filesDeleted} files deleted, ${report.filesUpdated} files updated)`,
          report.dockId,
        );
        const result = changeCommandResult("uninstall", [
          uninstallChangeReport(report, { operation: "uninstall", status: "uninstalled" }),
        ]);
        events.result(result);
        if (options.events === true) {
          return;
        }
        if (options.json === true) {
          printJson(result);
          return;
        }
        console.log(
          `${terminalStyle.success("Uninstalled")} ${terminalStyle.bold(
            report.dockId,
          )} (${formatFileCount(report.filesDeleted, "files deleted", "deleted")}, ${formatFileCount(
            report.filesUpdated,
            "files updated",
            "updated",
          )})`,
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "uninstall", error, dockId);
        handleChangeCommandError("uninstall", error, options.json === true, events);
      }
    });
}
