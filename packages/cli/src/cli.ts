#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { c as createTar } from "tar";
import { TokenStore } from "./auth.js";
import { bootstrapMac, bootstrapWindows } from "./bootstrap.js";
import { performBrowserLogin } from "./browser-auth.js";
import { DEFAULT_REGISTRY_URL, SCHEMA_VERSION, VERSION } from "./constants.js";
import {
  DockInstaller,
  type FileChangeDetails,
  type InstallReport,
  type UninstallReport,
} from "./core/app/dock-installer.js";
import {
  type DockManifest,
  DockRef,
  parseManifestFile,
  validateManifestFor,
} from "./core/domain/manifest.js";
import { type InstalledDockRecord, OpenDockStateStore } from "./core/domain/state-store.js";
import { fileChecksum } from "./core/files/checksum.js";
import { assertRegularOrMissing, safeJoin } from "./core/files/path-utils.js";
import type { RuntimeProgressEvent } from "./core/runtime/progress.js";
import { TaskRunner } from "./core/runtime/task-runner.js";
import { appendRunLog, type RunStatus, readProjectLogs } from "./logging.js";
import {
  detectPlatform,
  type OpenDockPlatform,
  type OpenDockReleasePlatform,
  parsePlatform,
  parseReleasePlatform,
} from "./platform.js";
import {
  type AuthProvider,
  type DockVersionResponse,
  OpenDockRegistryClient,
  RegistryRequestError,
  type SubmissionLogoRequest,
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

const maxDeployReadmeBytes = 64 * 1024;
const maxDeployLogoBytes = 512 * 1024;
const maxDeployManifestBytes = 64 * 1024;
const maxDeployArchiveBytes = 50 * 1024 * 1024;
const hookTimeoutMs = 30_000;

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

  program
    .command("verify-hook")
    .alias("run-hook")
    .description("Verify and run an OpenDock-managed hook target.")
    .argument("<dock>", "Installed dock id: owner/name")
    .argument("<file>", "OpenDock-managed JavaScript file to execute")
    .action((dock: string, file: string) => {
      let dockId = dockIdFromReference(dock);
      try {
        const parsedDockId = parseInstalledDockId(dock);
        dockId = parsedDockId;
        runVerifiedHook(process.cwd(), parsedDockId, file);
        recordCommandLog("verify-hook", "Success", `verified and ran ${file}`, parsedDockId);
      } catch (error) {
        recordCommandFailure("verify-hook", error, dockId);
        throw error;
      }
    });

  program
    .command("doctor")
    .description("Diagnose the current directory's OpenDock state.")
    .option("--platform <platform>", "Override the platform recorded in .opendock/dock.lock.yml")
    .action(async (options: { platform?: string }) => {
      try {
        await printDoctor(process.cwd(), options.platform);
        recordCommandLog("doctor", "Success", "doctor completed");
      } catch (error) {
        recordCommandFailure("doctor", error);
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
    .option("--provider <provider>", "Browser login provider: google or github", "google")
    .action(async (options: { token?: string; provider: string }) => {
      try {
        const tokenStore = new TokenStore();
        if (options.token) {
          await tokenStore.saveToken(options.token);
          console.log(terminalStyle.success("Logged in to OpenDock Registry."));
          recordCommandLog("auth login", "Success", "stored provided auth token");
          return;
        }
        const provider = parseAuthProvider(options.provider);
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
    .option("--platform <platform>", "Release platform: any, macos, windows, or linux")
    .option("--file <path>", "Manifest file to submit as dock.yml", "dock.yml")
    .action(async (dockName: string, options: { platform?: string; file: string }) => {
      let dockId = dockIdFromReference(dockName);
      try {
        const dockRef = parseDeployRef(dockName);
        dockId = dockRef.id();
        const manifestPath = resolveDeployManifest(process.cwd(), options.file);
        const releasePlatform = resolveDeployPlatform(options.platform, manifestPath);
        const deployRoot = dirname(manifestPath);
        const manifest = readFileSync(manifestPath, "utf8");
        const parsedManifest = parseManifestFile(manifestPath);
        validateManifestFor(parsedManifest, dockRef);
        const readmeMarkdown = readDeployReadme(deployRoot, parsedManifest);
        const logo = readDeployLogo(deployRoot, parsedManifest);
        const archive = await createDeployArchive(
          deployRoot,
          parsedManifest,
          dockRef.requested(),
          releasePlatform,
          manifest,
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

  await program.parseAsync(argv);
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

function runVerifiedHook(projectDir: string, dockId: string, filePath: string): void {
  const normalizedPath = filePath.trim().replaceAll("\\", "/").replaceAll(/\/+/g, "/");
  if (![".js", ".mjs", ".cjs"].includes(extname(normalizedPath).toLowerCase())) {
    throw new Error("hook target must be a JavaScript file managed by OpenDock");
  }

  const store = new OpenDockStateStore(projectDir);
  if (!store.hasState()) {
    throw new Error(".opendock/dock.lock.yml missing");
  }
  const dock = store.findDock(dockId);
  if (!dock) {
    throw new Error(`dock \`${dockId}\` is not installed in this project`);
  }
  const record = dock.files.find((file) => file.path === normalizedPath);
  if (!record) {
    throw new Error(`hook target is not managed by dock \`${dockId}\`: ${normalizedPath}`);
  }
  if (record.mode !== "managed_file") {
    throw new Error(`hook target must be checksum-managed: ${normalizedPath}`);
  }

  const absoluteTarget = safeJoin(projectDir, normalizedPath, "hook target");
  assertRegularOrMissing(absoluteTarget, normalizedPath);
  if (!existsSync(absoluteTarget)) {
    throw new Error(`hook target missing: ${normalizedPath}`);
  }
  if (fileChecksum(absoluteTarget) !== record.checksum) {
    throw new Error(`checksum mismatch for hook target ${normalizedPath}`);
  }

  const result = spawnSync(process.execPath, [absoluteTarget], {
    cwd: projectDir,
    env: hookEnvironment(),
    stdio: "inherit",
    timeout: hookTimeoutMs,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`hook target terminated by ${result.signal}: ${normalizedPath}`);
  }
  if (result.status !== 0) {
    throw new Error(`hook target failed with exit code ${result.status ?? 1}: ${normalizedPath}`);
  }
}

function hookEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "CI",
    "ComSpec",
    "COMSPEC",
    "FORCE_COLOR",
    "HOME",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
    "USERNAME",
    "WINDIR",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
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
  if (
    metadata.platform !== undefined &&
    metadata.platform !== "any" &&
    metadata.platform !== platform
  ) {
    throw new Error(
      `registry returned ${metadata.platform} artifact for requested platform \`${platform}\``,
    );
  }
  const releasePlatform = metadata.platform ?? "any";
  if (
    releasePlatform !== "any" &&
    releasePlatform !== "macos" &&
    releasePlatform !== "windows" &&
    releasePlatform !== "linux"
  ) {
    throw new Error(`registry returned unsupported platform \`${releasePlatform}\``);
  }
  verifyReleaseSignature(
    {
      id: metadata.id,
      version: metadata.version,
      platform: releasePlatform as OpenDockReleasePlatform,
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

interface InstalledDockUpdateCheck {
  dock: InstalledDockRecord;
  latestVersion: string;
  platform: OpenDockPlatform;
  updateAvailable: boolean;
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

function readDeployReadme(projectDir: string, manifest: DockManifest): string | undefined {
  if (manifest.readme === undefined) {
    return undefined;
  }
  return readFileSync(
    resolveDeployFile(projectDir, manifest.readme, "readme", maxDeployReadmeBytes),
    "utf8",
  );
}

function readDeployLogo(
  projectDir: string,
  manifest: DockManifest,
): SubmissionLogoRequest | undefined {
  if (manifest.logo === undefined) {
    return undefined;
  }

  const logoPath = resolveDeployFile(projectDir, manifest.logo, "logo", maxDeployLogoBytes);
  const logoBytes = readFileSync(logoPath);
  const contentType = logoContentType(logoPath);
  validateLogoSignature(contentType, logoBytes);
  return {
    filename: basename(logoPath),
    content_type: contentType,
    data_base64: logoBytes.toString("base64"),
  };
}

function resolveDeployFile(
  projectDir: string,
  relativePathValue: string,
  manifestField: "logo" | "manifest" | "readme",
  maxBytes: number,
): string {
  const relativePath = relativePathValue.trim();
  if (relativePath === "") {
    throw new Error(`manifest \`${manifestField}\` path cannot be empty`);
  }

  const root = realpathSync(projectDir);
  const candidate = resolve(root, relativePath);
  const realCandidate = realpathSync(candidate);
  assertInsideDeployRoot(root, realCandidate, manifestField);

  const stats = statSync(realCandidate);
  if (!stats.isFile()) {
    throw new Error(`manifest \`${manifestField}\` path must point to a file`);
  }
  if (manifestField === "logo" && stats.size === 0) {
    throw new Error("manifest `logo` file cannot be empty");
  }
  if (stats.size > maxBytes) {
    throw new Error(`manifest \`${manifestField}\` file exceeds ${maxBytes} bytes`);
  }

  return realCandidate;
}

function assertInsideDeployRoot(root: string, candidate: string, field: string): void {
  const rel = relative(root, candidate);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${"/"}`) ||
    rel.startsWith(`..${"\\"}`)
  ) {
    throw new Error(`manifest \`${field}\` path must stay inside the dock directory`);
  }
}

function normalizeDeployPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    normalized === "" ||
    normalized === "." ||
    normalized === ".." ||
    isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`unsafe deploy archive path: ${value}`);
  }
  return normalized;
}

function logoContentType(path: string): SubmissionLogoRequest["content_type"] {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      throw new Error("manifest `logo` path must point to a png, jpg, jpeg, or webp file");
  }
}

function validateLogoSignature(
  contentType: SubmissionLogoRequest["content_type"],
  bytes: Buffer,
): void {
  const valid =
    contentType === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : contentType === "image/jpeg"
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : bytes.length >= 12 &&
          bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
          bytes.subarray(8, 12).toString("ascii") === "WEBP";

  if (!valid) {
    throw new Error("manifest `logo` bytes do not match file type");
  }
}

async function createDeployArchive(
  projectDir: string,
  manifest: DockManifest,
  version: string,
  platform: OpenDockReleasePlatform,
  manifestText: string,
): Promise<SubmissionRequest["archive"]> {
  const entries = collectDeployArchiveEntries(projectDir, manifest);
  const temp = mkdtempSync(join(tmpdir(), "opendock-deploy-"));
  const stage = join(temp, "stage");
  const archivePath = join(temp, "dock.tgz");
  try {
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "dock.yml"), manifestText);
    for (const entry of entries.filter((entry) => entry !== "dock.yml")) {
      const source = join(projectDir, entry);
      const target = join(stage, entry);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    await createTar(
      {
        cwd: stage,
        file: archivePath,
        gzip: true,
        noMtime: true,
        portable: true,
        strict: true,
      },
      entries,
    );
    const stats = statSync(archivePath);
    if (stats.size > maxDeployArchiveBytes) {
      throw new Error(`dock archive exceeds ${maxDeployArchiveBytes} bytes`);
    }
    const bytes = readFileSync(archivePath);
    return {
      filename: `${manifest.id.replace("/", "-")}-${version}-${platform}.tgz`,
      content_type: "application/gzip",
      data_base64: bytes.toString("base64"),
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    rmSync(temp, { force: true, recursive: true });
  }
}

function collectDeployArchiveEntries(projectDir: string, manifest: DockManifest): string[] {
  const roots = new Set<string>();
  for (const file of manifest.files) {
    roots.add(file.from);
  }
  for (const file of manifest.workdir?.files ?? []) {
    roots.add(file.from);
  }

  const entries = new Set<string>(["dock.yml"]);
  for (const root of roots) {
    for (const entry of expandDeployArchiveRoot(projectDir, root)) {
      entries.add(entry);
    }
  }
  return [...entries].sort();
}

function expandDeployArchiveRoot(projectDir: string, relativePathValue: string): string[] {
  const rel = normalizeDeployPath(relativePathValue);
  const path = resolveDeployFileOrDirectory(projectDir, rel);
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) {
    throw new Error(`deploy archive entry cannot be a symlink: ${rel}`);
  }
  if (stats.isFile()) {
    return [rel];
  }
  if (!stats.isDirectory()) {
    throw new Error(`deploy archive entry must be a regular file or directory: ${rel}`);
  }
  return listDeployDirectoryFiles(projectDir, path);
}

function listDeployDirectoryFiles(projectDir: string, root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    const rel = normalizeDeployPath(relative(projectDir, path));
    if (entry.isSymbolicLink()) {
      throw new Error(`deploy archive entry cannot be a symlink: ${rel}`);
    }
    if (entry.isDirectory()) {
      files.push(...listDeployDirectoryFiles(projectDir, path));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`deploy archive entry must be a regular file: ${rel}`);
    }
    files.push(rel);
  }
  return files;
}

function resolveDeployFileOrDirectory(projectDir: string, relativePathValue: string): string {
  const root = realpathSync(projectDir);
  const candidate = resolve(root, relativePathValue);
  if (lstatSync(candidate).isSymbolicLink()) {
    throw new Error(`deploy archive entry cannot be a symlink: ${relativePathValue}`);
  }
  const realCandidate = realpathSync(candidate);
  assertInsideDeployRoot(root, realCandidate, "archive entry");
  return realCandidate;
}

function resolveCliPlatform(value: string | undefined): OpenDockPlatform {
  return value === undefined ? detectPlatform() : parsePlatform(value);
}

function resolveDeployPlatform(
  value: string | undefined,
  manifestPath: string | undefined,
): OpenDockReleasePlatform {
  return value === undefined
    ? inferDeployPlatformFromManifestPath(manifestPath)
    : parseReleasePlatform(value);
}

function inferDeployPlatformFromManifestPath(
  manifestPath: string | undefined,
): OpenDockReleasePlatform {
  if (manifestPath === undefined) {
    return "any";
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
  return "any";
}

type JsonChangeOperation = "install" | "uninstall" | "update";
type JsonChangeStatus = "installed" | "unchanged" | "uninstalled" | "updated";
type JsonCommandErrorCode = "command_failed" | "managed_file_modified";

interface JsonDockUpdateCheckReport {
  currentVersion: string;
  dockId: string;
  latestVersion: string;
  platform: OpenDockPlatform;
  status: "current" | "outdated";
}

interface JsonUpdateCheckCommandResult {
  reports: JsonDockUpdateCheckReport[];
  success: true;
  summary: {
    current: string[];
    outdated: string[];
  };
  updatesAvailable: boolean;
}

interface JsonInstalledDockReport {
  dockId: string;
  fileCount: number;
  platform: OpenDockPlatform;
  requested: string;
  status: "installed";
  version: string;
}

interface JsonInstalledDockListCommandResult {
  docks: InstalledDockRecord[];
  hasState: boolean;
  lockPath: string;
  operation: "list";
  projectDir: string;
  projectPath: string;
  reports: JsonInstalledDockReport[];
  success: true;
  summary: {
    installed: string[];
  };
}

interface JsonDockChangeReport {
  dockId: string;
  fileChanges: FileChangeDetails;
  filesCreated: number;
  filesDeleted: number;
  filesReviewRequired: number;
  filesUpdated: number;
  fromVersion?: string;
  operation: JsonChangeOperation;
  platform?: OpenDockPlatform;
  status: JsonChangeStatus;
  toVersion?: string;
  version: string;
}

interface JsonChangeCommandResult {
  operation: JsonChangeOperation;
  reports: JsonDockChangeReport[];
  summary: JsonChangeSummary;
  success: true;
}

interface JsonChangeCommandFailureResult {
  errorCode: JsonCommandErrorCode;
  forceable: boolean;
  message: string;
  operation: JsonChangeOperation;
  reports: JsonDockChangeReport[];
  summary: JsonChangeSummary;
  success: false;
}

interface JsonChangeSummary {
  created: string[];
  deleted: string[];
  reviewRequired: string[];
  unchanged: string[];
  updated: string[];
}

interface ChangeCommandOutputMode {
  machine: boolean;
}

interface ChangeEventProgressDetails {
  current?: number;
  dockId?: string;
  level?: "INFO" | "OK" | "RUN" | "WARN" | "ERR";
  stepId?: string;
  total?: number;
  version?: string;
}

interface ChangeEventReporter {
  enabled: boolean;
  progress: (
    phase: string,
    message: string,
    percent: number,
    details?: ChangeEventProgressDetails,
  ) => void;
  result: (result: JsonChangeCommandFailureResult | JsonChangeCommandResult) => void;
}

function updateCheckCommandResult(
  updateChecks: InstalledDockUpdateCheck[],
): JsonUpdateCheckCommandResult {
  const reports = updateChecks.map((check) => ({
    currentVersion: check.dock.version,
    dockId: check.dock.id,
    latestVersion: check.latestVersion,
    platform: check.platform,
    status: check.updateAvailable ? ("outdated" as const) : ("current" as const),
  }));
  return {
    reports,
    success: true,
    summary: {
      current: reports
        .filter((report) => report.status === "current")
        .map((report) => report.dockId),
      outdated: reports
        .filter((report) => report.status === "outdated")
        .map((report) => report.dockId),
    },
    updatesAvailable: reports.some((report) => report.status === "outdated"),
  };
}

function installedDockListCommandResult(cwd: string): JsonInstalledDockListCommandResult {
  const store = new OpenDockStateStore(cwd);
  const hasState = store.hasState();
  const docks = hasState ? store.readLock().docks : [];
  const reports = docks.map((dock) => ({
    dockId: dock.id,
    fileCount: dock.files.length,
    platform: dock.platform,
    requested: dock.requested,
    status: "installed" as const,
    version: dock.version,
  }));
  return {
    docks,
    hasState,
    lockPath: store.lockPath(),
    operation: "list",
    projectDir: cwd,
    projectPath: store.projectPath(),
    reports,
    success: true,
    summary: {
      installed: reports.map((report) => report.dockId),
    },
  };
}

function installChangeReport(
  report: InstallReport,
  options: {
    fromVersion?: string;
    operation: JsonChangeOperation;
    status: JsonChangeStatus;
  },
): JsonDockChangeReport {
  return {
    dockId: report.dockId,
    fileChanges: report.fileChanges,
    filesCreated: report.filesCreated,
    filesDeleted: report.filesDeleted,
    filesReviewRequired: report.filesReviewRequired,
    filesUpdated: report.filesUpdated,
    ...(options.fromVersion === undefined ? {} : { fromVersion: options.fromVersion }),
    operation: options.operation,
    platform: report.platform,
    status: options.status,
    toVersion: report.version,
    version: report.version,
  };
}

function uninstallChangeReport(
  report: UninstallReport,
  options: {
    operation: JsonChangeOperation;
    status: JsonChangeStatus;
  },
): JsonDockChangeReport {
  return {
    dockId: report.dockId,
    fileChanges: report.fileChanges,
    filesCreated: 0,
    filesDeleted: report.filesDeleted,
    filesReviewRequired: report.filesReviewRequired,
    filesUpdated: report.filesUpdated,
    operation: options.operation,
    ...(report.platform === undefined ? {} : { platform: report.platform }),
    status: options.status,
    version: report.version,
  };
}

function changeCommandResult(
  operation: JsonChangeOperation,
  reports: JsonDockChangeReport[],
): JsonChangeCommandResult {
  return {
    operation,
    reports,
    summary: {
      created: uniqueFlatMap(reports, (report) => report.fileChanges.created),
      deleted: uniqueFlatMap(reports, (report) => report.fileChanges.deleted),
      reviewRequired: uniqueFlatMap(reports, (report) => report.fileChanges.reviewRequired),
      unchanged: reports
        .filter((report) => report.status === "unchanged")
        .map((report) => report.dockId),
      updated: uniqueFlatMap(reports, (report) => report.fileChanges.updated),
    },
    success: true,
  };
}

function changeCommandFailureResult(
  operation: JsonChangeOperation,
  error: unknown,
): JsonChangeCommandFailureResult {
  const forceable = isForceableManagedFileError(error);
  return {
    errorCode: forceable ? "managed_file_modified" : "command_failed",
    forceable,
    message: errorMessage(error),
    operation,
    reports: [],
    summary: emptyChangeSummary(),
    success: false,
  };
}

function emptyChangeSummary(): JsonChangeSummary {
  return {
    created: [],
    deleted: [],
    reviewRequired: [],
    unchanged: [],
    updated: [],
  };
}

function handleChangeCommandError(
  operation: JsonChangeOperation,
  error: unknown,
  json: boolean,
  events: ChangeEventReporter = createChangeEventReporter(operation, false),
): void {
  if (!json && !events.enabled) {
    throw error;
  }
  const result = changeCommandFailureResult(operation, error);
  if (events.enabled) {
    events.progress("error", result.message, 100, { level: "ERR" });
    events.result(result);
  } else {
    printJson(result);
  }
  process.exitCode = 1;
}

function changeCommandOutputMode(
  options: Pick<ChangeCommandOptions, "events" | "json">,
): ChangeCommandOutputMode {
  return {
    machine: options.events === true || options.json === true,
  };
}

function createChangeEventReporter(
  operation: JsonChangeOperation,
  enabled: boolean,
): ChangeEventReporter {
  return {
    enabled,
    progress: (phase, message, percent, details = {}) => {
      if (!enabled) {
        return;
      }
      printJson({
        opendock: 1,
        type: "progress",
        operation,
        phase,
        message,
        percent: clampProgressPercent(percent),
        level: details.level ?? "RUN",
        ...(details.current === undefined ? {} : { current: details.current }),
        ...(details.dockId === undefined ? {} : { dockId: details.dockId }),
        ...(details.stepId === undefined ? {} : { stepId: details.stepId }),
        ...(details.total === undefined ? {} : { total: details.total }),
        ...(details.version === undefined ? {} : { version: details.version }),
      });
    },
    result: (result) => {
      if (!enabled) {
        return;
      }
      printJson({
        opendock: 1,
        type: "result",
        operation,
        success: result.success,
        result,
      });
    },
  };
}

function clampProgressPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function runtimeProgressReporter(
  events: ChangeEventReporter,
  mapPercent: (percent: number) => number = (percent) => percent,
): (event: RuntimeProgressEvent) => void {
  return (event) => {
    relayRuntimeProgress(events, event, mapPercent);
  };
}

function relayRuntimeProgress(
  events: ChangeEventReporter,
  event: RuntimeProgressEvent,
  mapPercent: (percent: number) => number,
): void {
  events.progress(event.phase, event.message, mapPercent(event.percent ?? 50), {
    ...(event.current === undefined ? {} : { current: event.current }),
    ...(event.dockId === undefined ? {} : { dockId: event.dockId }),
    ...(event.level === undefined ? {} : { level: event.level }),
    ...(event.stepId === undefined ? {} : { stepId: event.stepId }),
    ...(event.total === undefined ? {} : { total: event.total }),
    ...(event.version === undefined ? {} : { version: event.version }),
  });
}

function updateProgressPercent(index: number, total: number, phaseOffset: number): number {
  const slotCount = Math.max(total, 1);
  const slotSize = 48 / slotCount;
  return Math.min(90, Math.round(40 + slotSize * index + slotSize * phaseOffset));
}

function updateNestedProgressPercent(index: number, total: number, innerPercent: number): number {
  const slotCount = Math.max(total, 1);
  const slotSize = 48 / slotCount;
  return Math.min(90, Math.round(40 + slotSize * index + (slotSize * innerPercent) / 100));
}

function optionalDockEventDetails(dockId: string | undefined): ChangeEventProgressDetails {
  return dockId === undefined ? {} : { dockId };
}

function isForceableManagedFileError(error: unknown): boolean {
  const message = errorMessage(error);
  return [
    "checksum mismatch for managed block",
    "checksum mismatch for managed file",
    "managed block file missing",
    "managed block missing",
    "managed file missing",
  ].some((prefix) => message.startsWith(prefix));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function totalFileChanges(fileChanges: FileChangeDetails): number {
  return (
    fileChanges.created.length +
    fileChanges.deleted.length +
    fileChanges.reviewRequired.length +
    fileChanges.updated.length
  );
}

function uniqueFlatMap<T>(items: T[], map: (item: T) => string[]): string[] {
  return [...new Set(items.flatMap(map))];
}

async function runMaybeQuietAsync<T>(quiet: boolean, fn: () => Promise<T>): Promise<T> {
  if (!quiet) {
    return fn();
  }
  const previous = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map((arg) => String(arg)).join(" ");
    if (isOpenDockEventOutputLine(line)) {
      previous(...args);
    }
  };
  try {
    return await fn();
  } finally {
    console.log = previous;
  }
}

function runMaybeQuiet<T>(quiet: boolean, fn: () => T): T {
  if (!quiet) {
    return fn();
  }
  const previous = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map((arg) => String(arg)).join(" ");
    if (isOpenDockEventOutputLine(line)) {
      previous(...args);
    }
  };
  try {
    return fn();
  } finally {
    console.log = previous;
  }
}

function isOpenDockEventOutputLine(line: string): boolean {
  try {
    const value = JSON.parse(line);
    return value?.opendock === 1 && typeof value.type === "string";
  } catch {
    return false;
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}

function resolveDeployManifest(projectDir: string, relativePathValue: string): string {
  return resolveDeployFile(projectDir, relativePathValue, "manifest", maxDeployManifestBytes);
}

function formatFileSummary(report: InstallReport): string {
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

function plainInstallFileSummary(report: InstallReport): string {
  return `${report.filesCreated} files created, ${report.filesUpdated} files updated, ${report.filesDeleted} files deleted, ${report.filesReviewRequired} review required`;
}

function formatFileCount(
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

function printFileChanges(report: InstallReport): void {
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

async function printDoctor(cwd: string, platformOverride?: string): Promise<void> {
  console.log(terminalStyle.bold("OpenDock Doctor"));
  console.log(`${terminalStyle.dim("Project:")} ${cwd}`);

  const store = new OpenDockStateStore(cwd);
  if (store.hasState()) {
    console.log(`Status: ${formatStatus("Ready")}`);
    console.log(`${terminalStyle.bold("Checks")}:`);
    console.log(`${formatStepSymbol("✓")} .opendock/project.yml`);
    console.log(`${formatStepSymbol("✓")} .opendock/dock.lock.yml`);
    const lock = store.readLock();
    for (const dock of lock.docks) {
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
