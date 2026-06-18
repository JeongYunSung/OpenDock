#!/usr/bin/env bun
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerAuthCommands } from "./cli-auth-commands.js";
import { registerBootstrapCommands } from "./cli-bootstrap-commands.js";
import { registerChangeCommands } from "./cli-change-commands.js";
import { registerDeployCommand } from "./cli-deploy-command.js";
import { normalizeCliArgv } from "./cli-options.js";
import { registerProjectCommands } from "./cli-project-commands.js";
import { VERSION } from "./constants.js";
import { terminalStyle } from "./terminal-style.js";

export async function run(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("opendock")
    .description("Install, inspect, update, remove, and deploy OpenDock docks.")
    .version(VERSION);

  registerChangeCommands(program);
  registerProjectCommands(program);
  registerBootstrapCommands(program);
  registerAuthCommands(program);
  registerDeployCommand(program, argv);

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
