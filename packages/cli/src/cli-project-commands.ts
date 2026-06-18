import { Command } from "commander";
import { printJson } from "./change-events.js";
import { updateCheckCommandResult } from "./change-output.js";
import { recordCommandFailure, recordCommandLog } from "./cli-command-log.js";
import { dockIdFromReference, parseInstalledDockId, resolveCliPlatform } from "./cli-options.js";
import {
  printDoctor,
  printInstalledDocks,
  printUpdateChecks,
  readInstalledDocks,
} from "./cli-project-output.js";
import { DEFAULT_REGISTRY_URL, SCHEMA_VERSION, VERSION } from "./constants.js";
import { OpenDockStateStore } from "./core/domain/state-store.js";
import { checkInstalledDockUpdates } from "./installed-dock-updates.js";
import { readProjectLogs } from "./logging.js";
import { formatStatus, terminalStyle } from "./terminal-style.js";
import { runVerifiedCommand } from "./verified-command.js";

export function registerProjectCommands(program: Command): void {
  const runCommand = new Command("run")
    .description("Run a named helper or check installed by a dock.")
    .argument("<command>", "Command name declared in dock.yml")
    .option("--dock <dock>", "Installed dock id to run from when command names overlap")
    .action(async (command: string, options: { dock?: string }) => {
      let dockId = options.dock === undefined ? undefined : dockIdFromReference(options.dock);
      try {
        const store = new OpenDockStateStore(process.cwd());
        if (!store.hasState()) {
          throw new Error(".opendock/dock.lock.yml missing");
        }
        const report = await runVerifiedCommand(
          process.cwd(),
          command,
          store.readLock().docks,
          options.dock === undefined ? {} : { dockId: parseInstalledDockId(options.dock) },
        );
        dockId = report.dockId;
        recordCommandLog(
          process.cwd(),
          "run",
          "Success",
          `ran ${report.command} from ${report.dockId}@${report.version}`,
          report.dockId,
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "run", error, dockId);
        throw error;
      }
    });
  program.addCommand(runCommand);

  program
    .command("doctor")
    .argument("[dock]", "Installed dock id to diagnose, e.g. opendock/oma")
    .description("Diagnose the current directory's OpenDock state.")
    .option("--platform <platform>", "Override the platform recorded in .opendock/dock.lock.yml")
    .action(async (dock: string | undefined, options: { platform?: string }) => {
      let dockId: string | undefined;
      try {
        dockId = dock === undefined ? undefined : dockIdFromReference(dock);
        if (dock !== undefined && dockId === undefined) {
          throw new Error("dock id must be in owner/name form");
        }
        await printDoctor(process.cwd(), options.platform, dockId);
        recordCommandLog(
          process.cwd(),
          "doctor",
          "Success",
          dockId === undefined ? "doctor completed" : `doctor completed for ${dockId}`,
          dockId,
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "doctor", error, dockId);
        throw error;
      }
    });

  program
    .command("list")
    .description("Show docks installed in the current directory.")
    .option("--json", "Print a machine-readable installed dock list")
    .action((options: { json?: boolean }) => {
      try {
        printInstalledDocks(process.cwd(), options.json === true);
        const docks = readInstalledDocks(process.cwd()) ?? [];
        recordCommandLog(
          process.cwd(),
          "list",
          docks.length === 0 ? "Skipped" : "Success",
          docks.length === 0
            ? "no docks installed in this project"
            : `listed ${docks.length} installed dock(s)`,
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "list", error);
        throw error;
      }
    });

  program
    .command("outdated")
    .description("Check installed docks for newer approved Registry releases.")
    .option("--platform <platform>", "Override the platform recorded in .opendock/dock.lock.yml")
    .option("--json", "Print a machine-readable update check report")
    .action(async (options: { json?: boolean; platform?: string }) => {
      try {
        const platformOverride =
          options.platform === undefined ? undefined : resolveCliPlatform(options.platform);
        const docks = readInstalledDocks(process.cwd());
        if (docks === undefined || docks.length === 0) {
          recordCommandLog(
            process.cwd(),
            "outdated",
            "Skipped",
            "no docks installed in this project",
          );
          if (options.json === true) {
            printJson(updateCheckCommandResult([]));
          } else {
            console.log(terminalStyle.dim("No OpenDock docks installed in this project."));
          }
          return;
        }
        const updateChecks = await checkInstalledDockUpdates(docks, platformOverride);
        const updates = updateChecks.filter((check) => check.updateAvailable);
        recordCommandLog(
          process.cwd(),
          "outdated",
          updates.length === 0 ? "Skipped" : "Success",
          updates.length === 0
            ? `no updates available for ${updateChecks.length} installed dock(s)`
            : `found ${updates.length} update(s) for ${updateChecks.length} installed dock(s)`,
        );
        if (options.json === true) {
          printJson(updateCheckCommandResult(updateChecks));
          return;
        }
        printUpdateChecks(process.cwd(), updateChecks);
      } catch (error) {
        recordCommandFailure(process.cwd(), "outdated", error);
        throw error;
      }
    });

  program
    .command("log")
    .description("Show recent OpenDock logs for the current directory.")
    .action(() => {
      try {
        const logs = readProjectLogs(process.cwd());
        if (logs.length === 0) {
          console.log(terminalStyle.dim("No OpenDock logs for this project."));
          recordCommandLog(process.cwd(), "log", "Skipped", "no logs for this project");
          return;
        }
        for (const log of logs.slice(-20)) {
          console.log(
            `${terminalStyle.dim(log.timestamp)} ${formatStatus(log.status)} ${terminalStyle.bold(
              log.command,
            )} ${log.message}`,
          );
        }
        recordCommandLog(
          process.cwd(),
          "log",
          "Success",
          `displayed ${Math.min(logs.length, 20)} log(s)`,
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "log", error);
        throw error;
      }
    });

  program
    .command("version")
    .description("Show CLI, schema, and registry information.")
    .action(() => {
      try {
        console.log(`opendock ${VERSION}`);
        console.log(`schema ${SCHEMA_VERSION}`);
        console.log(`registry ${DEFAULT_REGISTRY_URL}`);
        recordCommandLog(process.cwd(), "version", "Success", `opendock ${VERSION}`);
      } catch (error) {
        recordCommandFailure(process.cwd(), "version", error);
        throw error;
      }
    });
}
