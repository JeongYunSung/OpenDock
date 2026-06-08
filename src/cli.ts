#!/usr/bin/env node
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { TokenStore } from "./auth.js";
import { bootstrapMac } from "./bootstrap.js";
import { DEFAULT_REGISTRY_URL, SCHEMA_VERSION, VERSION } from "./constants.js";
import { DockRef, parseManifestFile } from "./dock.js";
import { type InstallReport, install } from "./installer.js";
import { readProjectLogs } from "./logging.js";
import { detectPlatform, type OpenDockPlatform, parsePlatform } from "./platform.js";
import { hasProjectState, lockDocks, readLock } from "./project.js";
import { OpenDockRegistryClient } from "./registry.js";
import { resolveDock } from "./resolver.js";
import { runLifecycle } from "./runner.js";

const maxDeployReadmeBytes = 64 * 1024;

export async function run(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("opendock")
    .description("Install, update, diagnose, and deploy OpenDock docks.")
    .version(VERSION);

  program
    .command("install")
    .description("Install an approved dock into the current directory.")
    .argument("<dock>", "Dock reference: owner/name[@selector]")
    .option("--force", "Overwrite user-edited managed files")
    .option("--platform <platform>", "Target platform: macos, windows, or linux")
    .action(async (dock: string, options: { force?: boolean; platform?: string }) => {
      const platform = resolveCliPlatform(options.platform);
      const report = await install({
        dockRef: DockRef.parse(dock),
        force: options.force === true,
        projectDir: process.cwd(),
        runCommands: true,
        operation: "install",
        phase: "install",
        platform,
      });
      console.log(
        `Installed ${report.dockId}@${report.version} for ${report.platform} (${formatFileSummary(report)})`,
      );
    });

  program
    .command("update")
    .description("Update the dock installed in the current directory.")
    .option("--force", "Overwrite user-edited managed files")
    .option("--platform <platform>", "Override the platform recorded in .opendock/dock.lock.yml")
    .action(async (options: { force?: boolean; platform?: string }) => {
      const lock = readLock(process.cwd());
      for (const dock of lockDocks(lock)) {
        const dockRef = DockRef.parse(`${dock.id}@${dock.requested ?? "latest"}`);
        const platform = resolveCliPlatform(options.platform ?? dock.platform);
        const report = await install({
          dockRef,
          force: options.force === true,
          projectDir: process.cwd(),
          runCommands: true,
          operation: "update",
          phase: "update",
          platform,
        });
        if (dock.version === report.version) {
          console.log(
            `Updated ${dock.id} at ${report.version} for ${report.platform} (${formatFileSummary(report)})`,
          );
        } else {
          console.log(
            `Updated ${dock.id}: ${dock.version} -> ${report.version} for ${report.platform} (${formatFileSummary(report)})`,
          );
        }
      }
    });

  program
    .command("doctor")
    .description("Diagnose the current directory's OpenDock state.")
    .option("--platform <platform>", "Override the platform recorded in .opendock/dock.lock.yml")
    .action(async (options: { platform?: string }) => {
      await printDoctor(process.cwd(), options.platform);
    });

  program
    .command("log")
    .description("Show recent OpenDock logs for the current directory.")
    .action(() => {
      const logs = readProjectLogs(process.cwd());
      if (logs.length === 0) {
        console.log("No OpenDock logs for this project.");
        return;
      }
      for (const log of logs.slice(-20)) {
        console.log(`${log.timestamp} ${log.status} ${log.command} ${log.message}`);
      }
    });

  program
    .command("version")
    .description("Show CLI, schema, and registry information.")
    .action(() => {
      console.log(`opendock ${VERSION}`);
      console.log(`schema ${SCHEMA_VERSION}`);
      console.log(`registry ${DEFAULT_REGISTRY_URL}`);
    });

  const bootstrap = program.command("bootstrap").description("Prepare first-party host tools.");
  bootstrap
    .command("mac")
    .description("Install or verify Homebrew for macOS docks.")
    .option("-y, --yes", "Run the official Homebrew installer without OpenDock confirmation")
    .action(async (options: { yes?: boolean }) => {
      await bootstrapMac({ assumeYes: options.yes === true });
    });

  const auth = program.command("auth").description("Authenticate with OpenDock Registry.");
  auth
    .command("login")
    .description("Log in to OpenDock Registry.")
    .option("--token <token>", "Token to store")
    .action(async (options: { token?: string }) => {
      const token = options.token ?? (await promptToken());
      await new TokenStore().saveToken(token);
      console.log("Logged in to OpenDock Registry.");
    });

  program
    .command("deploy")
    .description("Submit a dock to OpenDock Registry for review.")
    .argument("<dock-name>")
    .action(async (dockName: string) => {
      const token = new TokenStore().loadToken();
      if (!token) {
        throw new Error("not logged in; run `opendock auth login` first");
      }
      const manifest = readFileSync("dock.yml", "utf8");
      const readmeMarkdown = readDeployReadme(process.cwd(), "dock.yml");
      const client = new OpenDockRegistryClient();
      const request =
        readmeMarkdown === undefined
          ? { dock_name: dockName, manifest }
          : { dock_name: dockName, manifest, readme_markdown: readmeMarkdown };
      const response = await client.submitDock(request, token);
      console.log(`Submitted ${dockName} for review: ${response.id} (${response.status})`);
    });

  await program.parseAsync(argv);
}

function readDeployReadme(projectDir: string, manifestPath: string): string | undefined {
  const manifest = parseManifestFile(join(projectDir, manifestPath));
  if (manifest.readme === undefined) {
    return undefined;
  }

  const relativePath = manifest.readme.trim();
  if (relativePath === "") {
    throw new Error("manifest `readme` path cannot be empty");
  }

  const root = realpathSync(projectDir);
  const candidate = resolve(root, relativePath);
  const realCandidate = realpathSync(candidate);
  const rel = relative(root, realCandidate);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${"/"}`) ||
    rel.startsWith(`..${"\\"}`)
  ) {
    throw new Error("manifest `readme` path must stay inside the dock directory");
  }

  const stats = statSync(realCandidate);
  if (!stats.isFile()) {
    throw new Error("manifest `readme` path must point to a file");
  }
  if (stats.size > maxDeployReadmeBytes) {
    throw new Error(`manifest \`readme\` file exceeds ${maxDeployReadmeBytes} bytes`);
  }

  return readFileSync(realCandidate, "utf8");
}

function resolveCliPlatform(value: string | undefined): OpenDockPlatform {
  return value === undefined ? detectPlatform() : parsePlatform(value);
}

function formatFileSummary(report: InstallReport): string {
  return `${report.filesCreated} files created, ${report.filesUpdated} files updated, ${report.filesDeleted} files deleted, ${report.filesReviewRequired} review required`;
}

async function printDoctor(cwd: string, platformOverride?: string): Promise<void> {
  console.log("OpenDock Doctor");
  console.log(`Project: ${cwd}`);

  if (hasProjectState(cwd)) {
    console.log("Status: Ready");
    console.log("Checks:");
    console.log("✓ .opendock/project.yml");
    console.log("✓ .opendock/dock.lock.yml");
    const lock = readLock(cwd);
    for (const dock of lockDocks(lock)) {
      const platform = resolveCliPlatform(platformOverride ?? dock.platform);
      console.log(`✓ ${dock.id}@${dock.version} [${platform}]`);
      await printDockDoctorChecks(
        cwd,
        DockRef.parse(`${dock.id}@${dock.requested ?? "latest"}`),
        platform,
      );
    }
  } else {
    console.log("Status: Not installed");
    console.log("Checks:");
    console.log("! .opendock/project.yml missing");
    console.log("! .opendock/dock.lock.yml missing");
  }
}

async function printDockDoctorChecks(
  cwd: string,
  dockRef: DockRef,
  platform: OpenDockPlatform,
): Promise<void> {
  try {
    const resolved = await resolveDock(dockRef);
    const reports = await runLifecycle(resolved.manifest, "doctor", cwd, { platform });
    for (const report of reports) {
      const symbol = report.status === "Failed" ? "!" : "✓";
      const suffix = report.message ? ` (${report.message})` : "";
      console.log(`${symbol} ${report.id}${suffix}`);
    }
  } catch (error) {
    console.log(`! ${dockRef.id()} doctor checks unavailable: ${(error as Error).message}`);
  }
}

async function promptToken(): Promise<string> {
  const readline = createInterface({ input, output });
  try {
    const token = (await readline.question("OpenDock Registry token: ")).trim();
    if (token === "") {
      throw new Error("empty token");
    }
    return token;
  } finally {
    readline.close();
  }
}

run().catch((error: unknown) => {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
});
