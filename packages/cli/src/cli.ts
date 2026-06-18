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
  changeCommandResult,
  createChangeEventReporter,
  errorMessage,
  formatFileCount,
  formatFileSummary,
  handleChangeCommandError,
  type InstalledDockUpdateCheck,
  installChangeReport,
  installedDockListCommandResult,
  type JsonDockChangeReport,
  optionalDockEventDetails,
  plainInstallFileSummary,
  printFileChanges,
  printJson,
  runMaybeQuiet,
  runMaybeQuietAsync,
  runtimeProgressReporter,
  totalFileChanges,
  uninstallChangeReport,
  updateCheckCommandResult,
  updateNestedProgressPercent,
  updateProgressPercent,
} from "./change-output.js";
import { DEFAULT_REGISTRY_URL, SCHEMA_VERSION, VERSION } from "./constants.js";
import { DockInstaller } from "./core/app/dock-installer.js";
import { DockRef, manifestForRef, parseManifestFile } from "./core/domain/manifest.js";
import { type InstalledDockRecord, OpenDockStateStore } from "./core/domain/state-store.js";
import { TaskRunner } from "./core/runtime/task-runner.js";
import {
  createDeployArchive,
  readDeployLogo,
  readDeployReadme,
  resolveDeployManifest,
  validateDeployCommands,
} from "./deploy-package.js";
import { appendRunLog, type RunStatus, readProjectLogs } from "./logging.js";
import {
  detectPlatform,
  isOpenDockPlatform,
  type OpenDockPlatform,
  parsePlatform,
} from "./platform.js";
import {
  type AuthProvider,
  type DockVersionResponse,
  OpenDockRegistryClient,
  RegistryRequestError,
  type SubmissionRequest,
  type SubmissionResponse,
} from "./registry.js";
import { verifyReleaseSignature } from "./release-signature.js";
import { resolveDock } from "./resolver.js";
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
        recordCommandFailure("install", error, dockId);
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
        recordCommandFailure("update", error);
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
        recordCommandFailure("uninstall", error, dockId);
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
          "run",
          "Success",
          `ran ${report.command} from ${report.dockId}@${report.version}`,
          report.dockId,
        );
      } catch (error) {
        recordCommandFailure("run", error, dockId);
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
          "doctor",
          "Success",
          dockId === undefined ? "doctor completed" : `doctor completed for ${dockId}`,
          dockId,
        );
      } catch (error) {
        recordCommandFailure("doctor", error, dockId);
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
          "list",
          docks.length === 0 ? "Skipped" : "Success",
          docks.length === 0
            ? "no docks installed in this project"
            : `listed ${docks.length} installed dock(s)`,
        );
      } catch (error) {
        recordCommandFailure("list", error);
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
          recordCommandLog("outdated", "Skipped", "no docks installed in this project");
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
        recordCommandFailure("outdated", error);
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
          recordCommandLog("log", "Skipped", "no logs for this project");
          return;
        }
        for (const log of logs.slice(-20)) {
          console.log(
            `${terminalStyle.dim(log.timestamp)} ${formatStatus(log.status)} ${terminalStyle.bold(
              log.command,
            )} ${log.message}`,
          );
        }
        recordCommandLog("log", "Success", `displayed ${Math.min(logs.length, 20)} log(s)`);
      } catch (error) {
        recordCommandFailure("log", error);
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
        recordCommandLog("version", "Success", `opendock ${VERSION}`);
      } catch (error) {
        recordCommandFailure("version", error);
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
        recordCommandLog("bootstrap mac", "Success", "mac bootstrap completed");
      } catch (error) {
        recordCommandFailure("bootstrap mac", error);
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
        recordCommandLog("bootstrap windows", "Success", "windows bootstrap completed");
      } catch (error) {
        recordCommandFailure("bootstrap windows", error);
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
          recordCommandLog("auth login", "Success", "stored provided auth token");
          return;
        }
        const provider =
          options.provider === undefined
            ? await selectAuthProvider()
            : parseAuthProvider(options.provider);
        await performBrowserLogin({ tokenStore, provider });
        recordCommandLog("auth login", "Success", `browser login completed with ${provider}`);
      } catch (error) {
        recordCommandFailure("auth login", error);
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
          recordCommandLog("auth status", "Skipped", "not logged in");
          return;
        }
        const user = await new OpenDockRegistryClient().currentUser(token);
        console.log(`${terminalStyle.success("Logged in as")} ${terminalStyle.bold(user.email)}.`);
        recordCommandLog("auth status", "Success", `logged in as ${user.email}`);
      } catch (error) {
        recordCommandFailure("auth status", error);
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
          "auth logout",
          token ? "Success" : "Skipped",
          token ? "logged out of registry" : "no local auth token to clear",
        );
      } catch (error) {
        recordCommandFailure("auth logout", error);
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
        recordCommandFailure("deploy", error, dockId);
        throw error;
      }
    });

  await program.parseAsync(normalizeCliArgv(argv), { from: "user" });
}

const cliCommandNames = new Set([
  "auth",
  "bootstrap",
  "deploy",
  "doctor",
  "install",
  "list",
  "log",
  "outdated",
  "run",
  "uninstall",
  "update",
  "version",
]);

function normalizeCliArgv(argv: string[]): string[] {
  const first = basename(argv[0] ?? "");
  const second = basename(argv[1] ?? "");
  if (first === "bun" || first === "node") {
    return cliCommandNames.has(argv[1] ?? "") ? argv.slice(1) : argv.slice(2);
  }
  if (first === "opendock" || second === "opendock" || second === "cli.ts") {
    return argv.slice(second === "opendock" || second === "cli.ts" ? 2 : 1);
  }
  return argv;
}

function parseDeployRef(value: string): DockRef {
  if (!value.includes("@")) {
    throw new Error(
      "deploy reference must use owner/name@version with an exact version identifier, e.g. opendock/oma@1.0.0",
    );
  }
  const dockRef = DockRef.parse(value);
  return dockRef;
}

function deployOptionValue(
  parsedValue: string | undefined,
  argv: string[],
  optionName: "--file" | "--platform",
): string | undefined {
  const equalsPrefix = `${optionName}=`;
  for (const [index, token] of argv.entries()) {
    if (token === optionName) {
      return argv[index + 1] ?? parsedValue;
    }
    if (token.startsWith(equalsPrefix)) {
      return token.slice(equalsPrefix.length);
    }
  }
  return parsedValue;
}

function parseInstallRef(value: string): DockRef {
  if (!value.includes("@")) {
    throw new Error(
      "install reference must use owner/name@version with an exact version identifier, e.g. opendock/codex@1.0.0",
    );
  }
  return DockRef.parse(value);
}

function parseInstalledDockId(value: string): string {
  const parts = value.trim().split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("dock id must be in owner/name form");
  }
  return `${parts[0]}/${parts[1]}`;
}

function dockIdFromReference(value: string): string | undefined {
  try {
    const [id] = value.trim().split("@");
    return parseInstalledDockId(id ?? "");
  } catch {
    return undefined;
  }
}

function recordCommandLog(
  command: string,
  status: RunStatus,
  message: string,
  dockId?: string,
): void {
  try {
    appendRunLog(process.cwd(), command, dockId, status, message);
  } catch {
    // Logging should never make the requested command fail.
  }
}

function recordCommandFailure(command: string, error: unknown, dockId?: string): void {
  recordCommandLog(command, "Failure", errorMessage(error), dockId);
}

function parseAuthProvider(value: string): AuthProvider {
  const normalized = value.trim().toLowerCase();
  if (normalized === "google" || normalized === "github") {
    return normalized;
  }
  throw new Error("auth provider must be google or github");
}

async function resolveLatestDockVersion(
  dockId: string,
  platform: OpenDockPlatform,
): Promise<DockVersionResponse> {
  const [owner, name, extra] = dockId.split("/");
  if (!owner || !name || extra !== undefined) {
    throw new Error(`invalid dock id in lock file: ${dockId}`);
  }
  const metadata = await new OpenDockRegistryClient().resolveDockVersion(
    owner,
    name,
    "latest",
    platform,
  );
  if (metadata.id !== dockId) {
    throw new Error(`registry returned dock id \`${metadata.id}\` for installed \`${dockId}\``);
  }
  if (!metadata.approved) {
    throw new Error(`dock \`${dockId}@latest\` is not approved by OpenDock Registry`);
  }
  if (metadata.platform !== undefined && metadata.platform !== platform) {
    throw new Error(
      `registry returned ${metadata.platform} artifact for requested platform \`${platform}\``,
    );
  }
  const releasePlatform = metadata.platform ?? platform;
  if (!isOpenDockPlatform(releasePlatform)) {
    throw new Error(`registry returned unsupported platform \`${releasePlatform}\``);
  }
  verifyReleaseSignature(
    {
      id: metadata.id,
      version: metadata.version,
      platform: releasePlatform,
      checksum: metadata.checksum,
    },
    metadata.signature,
  );
  return metadata;
}

function lockedDockVersionSelector(dock: { requested?: string; version: string }): string {
  const requested = dock.requested?.trim();
  if (requested !== undefined && requested !== "" && requested !== "latest") {
    return requested;
  }
  return dock.version;
}

async function checkInstalledDockUpdates(
  docks: InstalledDockRecord[],
  platformOverride: OpenDockPlatform | undefined,
): Promise<InstalledDockUpdateCheck[]> {
  return Promise.all(
    docks.map(async (dock) => {
      const platform = platformOverride ?? resolveCliPlatform(dock.platform);
      const latest = await resolveLatestDockVersion(dock.id, platform);
      return {
        dock,
        latestVersion: latest.version,
        platform,
        updateAvailable: latest.version !== dock.version,
      };
    }),
  );
}

function readInstalledDocks(cwd: string): InstalledDockRecord[] | undefined {
  const store = new OpenDockStateStore(cwd);
  if (!store.hasState()) {
    return undefined;
  }
  return store.readLock().docks;
}

function printInstalledDocks(cwd: string, json = false): void {
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

function printUpdateChecks(cwd: string, updateChecks: InstalledDockUpdateCheck[]): void {
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

function resolveCliPlatform(value: string | undefined): OpenDockPlatform {
  return value === undefined ? detectPlatform() : parsePlatform(value);
}

function resolveDeployPlatform(
  value: string | undefined,
  manifestPath: string | undefined,
): OpenDockPlatform {
  return value === undefined
    ? inferDeployPlatformFromManifestPath(manifestPath)
    : parsePlatform(value);
}

function inferDeployPlatformFromManifestPath(manifestPath: string | undefined): OpenDockPlatform {
  if (manifestPath === undefined) {
    return detectPlatform();
  }
  const tokens = new Set(basename(manifestPath).toLowerCase().split("."));
  if (tokens.has("macos") || tokens.has("mac") || tokens.has("darwin")) {
    return "macos";
  }
  if (tokens.has("windows") || tokens.has("win") || tokens.has("win32")) {
    return "windows";
  }
  if (tokens.has("linux")) {
    return "linux";
  }
  return detectPlatform();
}

async function submitDockWithLogin(
  client: OpenDockRegistryClient,
  tokenStore: TokenStore,
  request: SubmissionRequest,
): Promise<SubmissionResponse> {
  let token = await loadOrLoginToken(client, tokenStore);
  try {
    return await client.submitDock(request, token);
  } catch (error) {
    if (!(error instanceof RegistryRequestError && error.status === 401)) {
      throw error;
    }
    tokenStore.clearToken();
    token = (await performBrowserLogin({ client, tokenStore })).token;
    return client.submitDock(request, token);
  }
}

async function loadOrLoginToken(
  client: OpenDockRegistryClient,
  tokenStore: TokenStore,
): Promise<string> {
  const token = tokenStore.loadToken();
  if (token) {
    return token;
  }
  return (await performBrowserLogin({ client, tokenStore })).token;
}

async function printDoctor(cwd: string, platformOverride?: string, dockId?: string): Promise<void> {
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
