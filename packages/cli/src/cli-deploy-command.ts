import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Command } from "commander";
import { TokenStore } from "./auth.js";
import { recordCommandFailure, recordCommandLog } from "./cli-command-log.js";
import {
  deployOptionValue,
  dockIdFromReference,
  parseDeployRef,
  resolveDeployPlatform,
} from "./cli-options.js";
import { manifestForRef, parseManifestFile } from "./core/domain/manifest.js";
import { validateManifestTaskCommands } from "./core/runtime/task-command-validation.js";
import {
  createDeployArchive,
  readDeployLogo,
  readDeployReadme,
  resolveDeployManifest,
} from "./deploy-package.js";
import { submitDockWithLogin } from "./deploy-submit.js";
import { OpenDockRegistryClient } from "./registry.js";
import { formatListPlatform, formatStatus, terminalStyle } from "./terminal-style.js";

export function registerDeployCommand(program: Command, argv: string[]): void {
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
        validateManifestTaskCommands(parsedManifest, releasePlatform);
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
}
