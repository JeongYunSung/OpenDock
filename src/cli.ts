#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { TokenStore } from "./auth.js";
import { bootstrapMac } from "./bootstrap.js";
import { DEFAULT_REGISTRY_URL, SCHEMA_VERSION, VERSION } from "./constants.js";
import { DockHubClient } from "./dockhub.js";
import { install } from "./installer.js";
import { readProjectLogs } from "./logging.js";
import { PackRef } from "./pack.js";
import { detectPlatform, type OpenDockPlatform, parsePlatform } from "./platform.js";
import { hasProjectState, readLock } from "./project.js";
import { resolvePack } from "./resolver.js";
import { hasExplicitLifecycleSteps, runLifecycle } from "./runner.js";

export async function run(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("opendock")
    .description("Install, update, diagnose, and deploy OpenDock starterpacks.")
    .version(VERSION);

  program
    .command("install")
    .description("Install an approved starterpack into the current directory.")
    .argument("<pack>")
    .option("--platform <platform>", "Target platform: macos, windows, or linux")
    .action(async (pack: string, options: { platform?: string }) => {
      const platform = resolveCliPlatform(options.platform);
      const report = await install({
        packRef: PackRef.parse(pack),
        projectDir: process.cwd(),
        runCommands: true,
        operation: "install",
        phase: "install",
        platform,
      });
      console.log(
        `Installed ${report.packId}@${report.version} for ${report.platform} (${report.filesCreated} files created, ${report.filesUpdated} files updated)`,
      );
    });

  program
    .command("update")
    .description("Update the starterpack installed in the current directory.")
    .option("--platform <platform>", "Override the platform recorded in .opendock/dock.lock.yml")
    .action(async (options: { platform?: string }) => {
      const lock = readLock(process.cwd());
      for (const pack of lock.packs) {
        const packRef = PackRef.parse(pack.id);
        const platform = resolveCliPlatform(options.platform ?? pack.platform);
        const latest = await resolvePack(packRef);
        if (
          latest.manifest.version === pack.version &&
          !hasExplicitLifecycleSteps(latest.manifest, "update", { platform })
        ) {
          console.log(`${pack.id} is up to date at ${pack.version} for ${platform}`);
        } else {
          const report = await install({
            packRef,
            projectDir: process.cwd(),
            runCommands: true,
            operation: "update",
            phase: "update",
            platform,
          });
          if (pack.version === report.version) {
            console.log(`Updated ${pack.id} at ${report.version} for ${report.platform}`);
          } else {
            console.log(
              `Updated ${pack.id}: ${pack.version} -> ${report.version} for ${report.platform}`,
            );
          }
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
    .description("Show CLI, schema, and registry version information.")
    .action(() => {
      console.log(`opendock ${VERSION}`);
      console.log(`schema ${SCHEMA_VERSION}`);
      console.log(`registry ${DEFAULT_REGISTRY_URL}`);
    });

  const bootstrap = program.command("bootstrap").description("Prepare first-party host tools.");
  bootstrap
    .command("mac")
    .description("Install or verify Homebrew for macOS starterpacks.")
    .option("-y, --yes", "Run the official Homebrew installer without OpenDock confirmation")
    .action(async (options: { yes?: boolean }) => {
      await bootstrapMac({ assumeYes: options.yes === true });
    });

  const auth = program.command("auth").description("Authenticate with DockHub.");
  auth
    .command("login")
    .description("Log in to DockHub.")
    .option("--token <token>", "Token to store")
    .action(async (options: { token?: string }) => {
      const token = options.token ?? process.env.OPENDOCK_AUTH_TOKEN ?? (await promptToken());
      await new TokenStore().saveToken(token);
      console.log("Logged in to DockHub.");
    });

  program
    .command("deploy")
    .description("Submit a starterpack to DockHub for review.")
    .argument("<pack-name>")
    .action(async (packName: string) => {
      const token = new TokenStore().loadToken();
      if (!token) {
        throw new Error("not logged in; run `opendock auth login` first");
      }
      const manifest = readFileSync("dock.yml", "utf8");
      const client = new DockHubClient();
      const response = await client.submitPack({ pack_name: packName, manifest }, token);
      console.log(`Submitted ${packName} for review: ${response.id} (${response.status})`);
    });

  await program.parseAsync(argv);
}

function resolveCliPlatform(value: string | undefined): OpenDockPlatform {
  return value === undefined ? detectPlatform() : parsePlatform(value);
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
    for (const pack of lock.packs) {
      const platform = resolveCliPlatform(platformOverride ?? pack.platform);
      console.log(`✓ ${pack.id}@${pack.version} [${platform}]`);
      await printPackDoctorChecks(cwd, PackRef.parse(pack.id), platform);
    }
  } else {
    console.log("Status: Not installed");
    console.log("Checks:");
    console.log("! .opendock/project.yml missing");
    console.log("! .opendock/dock.lock.yml missing");
  }
}

async function printPackDoctorChecks(
  cwd: string,
  packRef: PackRef,
  platform: OpenDockPlatform,
): Promise<void> {
  try {
    const resolved = await resolvePack(packRef);
    const reports = await runLifecycle(resolved.manifest, "doctor", cwd, { platform });
    for (const report of reports) {
      const symbol = report.status === "Failed" ? "!" : "✓";
      const suffix = report.message ? ` (${report.message})` : "";
      console.log(`${symbol} ${report.id}${suffix}`);
    }
  } catch (error) {
    console.log(`! ${packRef.id()} doctor checks unavailable: ${(error as Error).message}`);
  }
}

async function promptToken(): Promise<string> {
  const readline = createInterface({ input, output });
  try {
    const token = (await readline.question("DockHub token: ")).trim();
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
