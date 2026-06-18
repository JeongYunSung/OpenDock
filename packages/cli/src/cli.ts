#!/usr/bin/env bun
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { TokenStore } from "./auth.js";
import { bootstrapMac, bootstrapWindows } from "./bootstrap.js";
import { performBrowserLogin, selectAuthProvider } from "./browser-auth.js";
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
  changeCommandResult,
  formatFileCount,
  formatFileSummary,
  handleChangeCommandError,
  installChangeReport,
  type JsonDockChangeReport,
  plainInstallFileSummary,
  printFileChanges,
  totalFileChanges,
  uninstallChangeReport,
  updateCheckCommandResult,
} from "./change-output.js";
import { recordCommandFailure, recordCommandLog } from "./cli-command-log.js";
import {
  deployOptionValue,
  dockIdFromReference,
  normalizeCliArgv,
  parseAuthProvider,
  parseDeployRef,
  parseInstalledDockId,
  parseInstallRef,
  resolveCliPlatform,
  resolveDeployPlatform,
} from "./cli-options.js";
import {
  printDoctor,
  printInstalledDocks,
  printUpdateChecks,
  readInstalledDocks,
} from "./cli-project-output.js";
import { DEFAULT_REGISTRY_URL, SCHEMA_VERSION, VERSION } from "./constants.js";
import { DockInstaller } from "./core/app/dock-installer.js";
import { DockRef, manifestForRef, parseManifestFile } from "./core/domain/manifest.js";
import { OpenDockStateStore } from "./core/domain/state-store.js";
import { validateDeployCommands } from "./deploy-command-policy.js";
import {
  createDeployArchive,
  readDeployLogo,
  readDeployReadme,
  resolveDeployManifest,
} from "./deploy-package.js";
import { submitDockWithLogin } from "./deploy-submit.js";
import { checkInstalledDockUpdates } from "./installed-dock-updates.js";
import { readProjectLogs } from "./logging.js";
import { OpenDockRegistryClient, RegistryRequestError } from "./registry.js";
import {
  formatDockVersion,
  formatListPlatform,
  formatPlatformName,
  formatStatus,
  formatStepSymbol,
  terminalStyle,
} from "./terminal-style.js";
import { runVerifiedCommand } from "./verified-command.js";

interface ChangeCommandOptions {
  events?: boolean;
  force?: boolean;
  json?: boolean;
  platform?: string;
}

export async function run(argv = process.argv): Promise<void> {
  const program = new Command();
  const installer = new DockInstaller();
  program
    .name("opendock")
    .description("Install, inspect, update, remove, and deploy OpenDock docks.")
    .version(VERSION);

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
            operation: "install",
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
              operation: "update",
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
    .action(async (options: Pick<ChangeCommandOptions, "json" | "platform">) => {
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

  const bootstrap = program.command("bootstrap").description("Prepare first-party host tools.");
  bootstrap
    .command("mac")
    .description("Install or verify Homebrew for macOS docks.")
    .option("-y, --yes", "Run the official Homebrew installer without OpenDock confirmation")
    .action(async (options: { yes?: boolean }) => {
      try {
        await bootstrapMac({ assumeYes: options.yes === true });
        recordCommandLog(process.cwd(), "bootstrap mac", "Success", "mac bootstrap completed");
      } catch (error) {
        recordCommandFailure(process.cwd(), "bootstrap mac", error);
        throw error;
      }
    });
  bootstrap
    .command("windows")
    .alias("win")
    .description("Verify WinGet or open Microsoft App Installer for Windows docks.")
    .option("-y, --yes", "Open Microsoft App Installer without OpenDock confirmation")
    .action(async (options: { yes?: boolean }) => {
      try {
        await bootstrapWindows({ assumeYes: options.yes === true });
        recordCommandLog(
          process.cwd(),
          "bootstrap windows",
          "Success",
          "windows bootstrap completed",
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "bootstrap windows", error);
        throw error;
      }
    });

  const auth = program.command("auth").description("Authenticate with OpenDock Registry.");
  auth
    .command("login")
    .description("Log in to OpenDock Registry.")
    .option("--token <token>", "Existing CLI token to store without opening a browser")
    .option("--provider <provider>", "Browser login provider: google or github")
    .action(async (options: { token?: string; provider?: string }) => {
      try {
        const tokenStore = new TokenStore();
        if (options.token) {
          await tokenStore.saveToken(options.token);
          console.log(terminalStyle.success("Logged in to OpenDock Registry."));
          recordCommandLog(process.cwd(), "auth login", "Success", "stored provided auth token");
          return;
        }
        const provider =
          options.provider === undefined
            ? await selectAuthProvider()
            : parseAuthProvider(options.provider);
        await performBrowserLogin({ tokenStore, provider });
        recordCommandLog(
          process.cwd(),
          "auth login",
          "Success",
          `browser login completed with ${provider}`,
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "auth login", error);
        throw error;
      }
    });
  auth
    .command("status")
    .description("Show the current OpenDock Registry login.")
    .action(async () => {
      try {
        const token = new TokenStore().loadToken();
        if (!token) {
          console.log(terminalStyle.warning("Not logged in."));
          recordCommandLog(process.cwd(), "auth status", "Skipped", "not logged in");
          return;
        }
        const user = await new OpenDockRegistryClient().currentUser(token);
        console.log(`${terminalStyle.success("Logged in as")} ${terminalStyle.bold(user.email)}.`);
        recordCommandLog(process.cwd(), "auth status", "Success", `logged in as ${user.email}`);
      } catch (error) {
        recordCommandFailure(process.cwd(), "auth status", error);
        throw error;
      }
    });
  auth
    .command("logout")
    .description("Log out of OpenDock Registry on this machine.")
    .action(async () => {
      try {
        const tokenStore = new TokenStore();
        const token = tokenStore.loadToken();
        if (token) {
          try {
            await new OpenDockRegistryClient().logout(token);
          } catch (error) {
            if (!(error instanceof RegistryRequestError && error.status === 401)) {
              throw error;
            }
          }
        }
        tokenStore.clearToken();
        console.log(terminalStyle.success("Logged out of OpenDock Registry."));
        recordCommandLog(
          process.cwd(),
          "auth logout",
          token ? "Success" : "Skipped",
          token ? "logged out of registry" : "no local auth token to clear",
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "auth logout", error);
        throw error;
      }
    });

  program
    .command("deploy")
    .description("Submit a dock to OpenDock Registry for review.")
    .argument("<dock>", "Dock release reference: owner/name@version")
    .option("--platform <platform>", "Release platform: macos, windows, or linux")
    .option("--file <path>", "Manifest file to submit as dock.yml", "dock.yml")
    .action(async (dockName: string, options: { platform?: string; file: string }) => {
      let dockId = dockIdFromReference(dockName);
      try {
        const dockRef = parseDeployRef(dockName);
        dockId = dockRef.id();
        const manifestPath = resolveDeployManifest(
          process.cwd(),
          deployOptionValue(options.file, argv, "--file") ?? "dock.yml",
        );
        const releasePlatform = resolveDeployPlatform(
          deployOptionValue(options.platform, argv, "--platform"),
          manifestPath,
        );
        const deployRoot = dirname(manifestPath);
        const manifest = readFileSync(manifestPath, "utf8");
        const parsedManifest = manifestForRef(parseManifestFile(manifestPath), dockRef);
        validateDeployCommands(deployRoot, parsedManifest);
        const readmeMarkdown = readDeployReadme(deployRoot, parsedManifest);
        const logo = readDeployLogo(deployRoot, parsedManifest);
        const archive = await createDeployArchive(
          deployRoot,
          parsedManifest,
          dockRef.requested(),
          releasePlatform,
          manifest,
          basename(manifestPath),
        );
        const client = new OpenDockRegistryClient();
        const request = {
          dock_name: dockRef.id(),
          version: dockRef.requested(),
          platform: releasePlatform,
          manifest,
          archive,
          ...(readmeMarkdown === undefined ? {} : { readme_markdown: readmeMarkdown }),
          ...(logo === undefined ? {} : { logo }),
        };
        const response = await submitDockWithLogin(client, new TokenStore(), request);
        recordCommandLog(
          process.cwd(),
          "deploy",
          "Success",
          `${dockRef.toString()} ${releasePlatform} submitted for review: ${response.id} (${response.status})`,
          dockRef.id(),
        );
        console.log(
          `${terminalStyle.success("Submitted")} ${terminalStyle.bold(
            dockRef.toString(),
          )} ${formatListPlatform(releasePlatform)} for review: ${terminalStyle.dim(
            response.id,
          )} (${formatStatus(response.status)})`,
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "deploy", error, dockId);
        throw error;
      }
    });

  await program.parseAsync(normalizeCliArgv(argv), { from: "user" });
}

if (isMainModule()) {
  run().catch((error: unknown) => {
    console.error(`${terminalStyle.stderrError("Error:")} ${(error as Error).message}`);
    process.exitCode = 1;
  });
}

function isMainModule(): boolean {
  if ((import.meta as ImportMeta & { main?: boolean }).main === true) {
    return true;
  }

  const entrypoint = process.argv[1];
  if (entrypoint === undefined) {
    return false;
  }
  try {
    return realpathSync(entrypoint) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
