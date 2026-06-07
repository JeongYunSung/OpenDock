#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { TokenStore } from "./auth.js";
import { DEFAULT_REGISTRY_URL, SCHEMA_VERSION, VERSION } from "./constants.js";
import { DockHubClient } from "./dockhub.js";
import { install } from "./installer.js";
import { readProjectLogs } from "./logging.js";
import { PackRef } from "./pack.js";
import { hasProjectState, readLock } from "./project.js";
import { resolvePack } from "./resolver.js";

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
    .action(async (pack: string) => {
      const report = await install({
        packRef: PackRef.parse(pack),
        projectDir: process.cwd(),
        runCommands: true,
        operation: "install",
      });
      console.log(
        `Installed ${report.packId}@${report.version} (${report.filesCreated} files created, ${report.filesUpdated} files updated)`,
      );
    });

  program
    .command("update")
    .description("Update the starterpack installed in the current directory.")
    .action(async () => {
      const lock = readLock(process.cwd());
      for (const pack of lock.packs) {
        const packRef = PackRef.parse(pack.id);
        const latest = await resolvePack(packRef);
        if (latest.manifest.version === pack.version) {
          console.log(`${pack.id} is up to date at ${pack.version}`);
        } else {
          const report = await install({
            packRef,
            projectDir: process.cwd(),
            runCommands: true,
            operation: "update",
          });
          console.log(`Updated ${pack.id}: ${pack.version} -> ${report.version}`);
        }
      }
    });

  program
    .command("doctor")
    .description("Diagnose the current directory's OpenDock state.")
    .action(() => {
      printDoctor(process.cwd());
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
      const registry = process.env.OPENDOCK_REGISTRY_URL ?? DEFAULT_REGISTRY_URL;
      const client = new DockHubClient(registry);
      const response = await client.submitPack({ pack_name: packName, manifest }, token);
      console.log(`Submitted ${packName} for review: ${response.id} (${response.status})`);
    });

  await program.parseAsync(argv);
}

function printDoctor(cwd: string): void {
  console.log("OpenDock Doctor");
  console.log(`Project: ${cwd}`);

  if (hasProjectState(cwd)) {
    console.log("Status: Ready");
    console.log("Checks:");
    console.log("✓ .opendock/project.yml");
    console.log("✓ .opendock/dock.lock.yml");
    const lock = readLock(cwd);
    for (const pack of lock.packs) {
      console.log(`✓ ${pack.id}@${pack.version}`);
    }
  } else {
    console.log("Status: Not installed");
    console.log("Checks:");
    console.log("! .opendock/project.yml missing");
    console.log("! .opendock/dock.lock.yml missing");
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
