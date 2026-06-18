import type { Command } from "commander";
import { bootstrapMac, bootstrapWindows } from "./bootstrap.js";
import { recordCommandFailure, recordCommandLog } from "./cli-command-log.js";

export function registerBootstrapCommands(program: Command): void {
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
}
